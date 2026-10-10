package sandbox

// The container engine: one fresh, locked-down container per execution, driven through the
// Docker SDK for Go. It knows nothing about the database; Service (sandbox.go) records results.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/client"
	"github.com/docker/docker/errdefs"
	"github.com/docker/docker/pkg/stdcopy"
)

// LabelSandbox marks every container this service creates, so leftovers can be found and removed.
const LabelSandbox = "tapu-sena.sandbox"

// ErrDockerUnavailable is returned when the Docker daemon cannot be reached.
var ErrDockerUnavailable = errors.New("docker is not available")

// ErrImageMissing is returned when the sandbox image has not been built.
var ErrImageMissing = errors.New("sandbox image is not built")

// errCancelled is the cancellation cause used by Service.Cancel.
var errCancelled = errors.New("cancelled by the researcher")

// Limits are enforced by Docker (cgroups), not by application code.
type Limits struct {
	NanoCPUs    int64 `json:"nano_cpus"`
	MemoryBytes int64 `json:"memory_bytes"`
	Pids        int64 `json:"pids"`
	TmpfsBytes  int64 `json:"tmpfs_bytes"`
}

func (l Limits) CPUs() float64 { return float64(l.NanoCPUs) / 1e9 }

// Mount is one bind mount. Sources must lie inside the engine's allowed root.
type Mount struct {
	Source   string
	Target   string
	ReadOnly bool
}

// Spec describes one container execution. It is built only by this package, never from API input.
type Spec struct {
	Name    string
	Image   string
	Cmd     []string
	Env     []string // KEY=VALUE
	Mounts  []Mount
	WorkDir string
	Network bool // only the install phase may use the network
	Limits  Limits
	Labels  map[string]string
}

// Outcome of one container execution.
type Outcome struct {
	ExitCode  int
	TimedOut  bool
	Cancelled bool
	OOMKilled bool
	Started   time.Time
	Finished  time.Time
}

// Runner abstracts the container runtime so the execution logic can be unit tested without Docker.
type Runner interface {
	Ping(ctx context.Context) error
	ImagePresent(ctx context.Context, image string) (bool, error)
	HostResources(ctx context.Context) (cpus int, memBytes int64, err error)
	// Run creates, starts, waits for and always removes the container. When ctx ends the
	// container is killed and ctx's error is returned.
	Run(ctx context.Context, spec Spec, stdout, stderr io.Writer) (exitCode int, oomKilled bool, err error)
	RemoveStale(ctx context.Context) (int, error)
}

// ---------- Docker SDK runner ----------

type DockerRunner struct {
	once sync.Once
	cli  *client.Client
	err  error
	host string // optional DOCKER_HOST override (tests)
}

// NewDockerRunner connects lazily using the standard DOCKER_HOST / named pipe configuration.
func NewDockerRunner() *DockerRunner { return &DockerRunner{} }

// NewDockerRunnerWithHost is used by tests to point at an unreachable daemon.
func NewDockerRunnerWithHost(host string) *DockerRunner { return &DockerRunner{host: host} }

func (d *DockerRunner) client() (*client.Client, error) {
	d.once.Do(func() {
		opts := []client.Opt{client.FromEnv, client.WithAPIVersionNegotiation()}
		if d.host != "" {
			opts = append(opts, client.WithHost(d.host))
		}
		d.cli, d.err = client.NewClientWithOpts(opts...)
	})
	if d.err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDockerUnavailable, d.err)
	}
	return d.cli, nil
}

func wrapDaemonErr(err error) error {
	if err == nil {
		return nil
	}
	if client.IsErrConnectionFailed(err) || errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(err.Error(), "cannot connect") || strings.Contains(err.Error(), "pipe") ||
		strings.Contains(err.Error(), "connection refused") || strings.Contains(err.Error(), "no such host") {
		return fmt.Errorf("%w: %v", ErrDockerUnavailable, err)
	}
	return err
}

func (d *DockerRunner) Ping(ctx context.Context) error {
	cli, err := d.client()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_, err = cli.Ping(ctx)
	return wrapDaemonErr(err)
}

func (d *DockerRunner) ImagePresent(ctx context.Context, image string) (bool, error) {
	cli, err := d.client()
	if err != nil {
		return false, err
	}
	_, err = cli.ImageInspect(ctx, image)
	if errdefs.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, wrapDaemonErr(err)
	}
	return true, nil
}

func (d *DockerRunner) HostResources(ctx context.Context) (int, int64, error) {
	cli, err := d.client()
	if err != nil {
		return 0, 0, err
	}
	info, err := cli.Info(ctx)
	if err != nil {
		return 0, 0, wrapDaemonErr(err)
	}
	return info.NCPU, info.MemTotal, nil
}

// HostConfig is the locked-down container configuration. Exported for the security tests.
func HostConfig(spec Spec) *container.HostConfig {
	network := "none"
	if spec.Network {
		network = "bridge"
	}
	pids := spec.Limits.Pids
	init := true
	mounts := make([]mount.Mount, 0, len(spec.Mounts))
	for _, m := range spec.Mounts {
		mounts = append(mounts, mount.Mount{Type: mount.TypeBind, Source: m.Source, Target: m.Target, ReadOnly: m.ReadOnly})
	}
	return &container.HostConfig{
		NetworkMode:    container.NetworkMode(network),
		Privileged:     false,
		CapDrop:        []string{"ALL"},
		SecurityOpt:    []string{"no-new-privileges:true"},
		ReadonlyRootfs: true,
		Tmpfs:          map[string]string{"/tmp": fmt.Sprintf("rw,nosuid,nodev,size=%d", spec.Limits.TmpfsBytes)},
		ShmSize:        256 << 20,
		IpcMode:        container.IPCModePrivate,
		Init:           &init,
		AutoRemove:     false, // removed explicitly after the output is collected
		Mounts:         mounts,
		Resources: container.Resources{
			NanoCPUs:   spec.Limits.NanoCPUs,
			Memory:     spec.Limits.MemoryBytes,
			MemorySwap: spec.Limits.MemoryBytes, // no swap beyond the memory limit
			PidsLimit:  &pids,
		},
	}
}

// ContainerConfig is the process configuration: non-root user, fixed argv, no TTY.
func ContainerConfig(spec Spec) *container.Config {
	labels := map[string]string{LabelSandbox: "1"}
	for k, v := range spec.Labels {
		labels[k] = v
	}
	return &container.Config{
		Image:           spec.Image,
		Cmd:             spec.Cmd,
		Env:             spec.Env,
		WorkingDir:      spec.WorkDir,
		User:            "1000:1000",
		Labels:          labels,
		NetworkDisabled: !spec.Network,
		AttachStdout:    true,
		AttachStderr:    true,
	}
}

func (d *DockerRunner) Run(ctx context.Context, spec Spec, stdout, stderr io.Writer) (int, bool, error) {
	cli, err := d.client()
	if err != nil {
		return -1, false, err
	}
	bg := context.WithoutCancel(ctx)
	created, err := cli.ContainerCreate(ctx, ContainerConfig(spec), HostConfig(spec), nil, nil, spec.Name)
	if err != nil {
		if errdefs.IsNotFound(err) {
			return -1, false, fmt.Errorf("%w: %s (build it with: docker build -t %s infra/sandbox-images/python)", ErrImageMissing, spec.Image, spec.Image)
		}
		if ctx.Err() != nil {
			return -1, false, ctx.Err()
		}
		return -1, false, wrapDaemonErr(err)
	}
	id := created.ID
	// The container is removed on every path: success, failure, timeout, cancellation.
	defer func() {
		rctx, cancel := context.WithTimeout(bg, 30*time.Second)
		defer cancel()
		_ = cli.ContainerRemove(rctx, id, container.RemoveOptions{Force: true, RemoveVolumes: true})
	}()

	att, err := cli.ContainerAttach(bg, id, container.AttachOptions{Stream: true, Stdout: true, Stderr: true})
	if err != nil {
		return -1, false, wrapDaemonErr(err)
	}
	defer att.Close()
	copied := make(chan struct{})
	go func() {
		_, _ = stdcopy.StdCopy(stdout, stderr, att.Reader)
		close(copied)
	}()

	waitCh, waitErr := cli.ContainerWait(bg, id, container.WaitConditionNextExit)
	if err := cli.ContainerStart(ctx, id, container.StartOptions{}); err != nil {
		if ctx.Err() != nil {
			return -1, false, ctx.Err()
		}
		return -1, false, wrapDaemonErr(err)
	}

	exitCode := -1
	var runErr error
	select {
	case st := <-waitCh:
		exitCode = int(st.StatusCode)
		if st.Error != nil && st.Error.Message != "" {
			runErr = errors.New(st.Error.Message)
		}
	case err := <-waitErr:
		runErr = wrapDaemonErr(err)
	case <-ctx.Done():
		kctx, cancel := context.WithTimeout(bg, 15*time.Second)
		_ = cli.ContainerKill(kctx, id, "KILL")
		cancel()
		select {
		case <-waitCh:
		case <-waitErr:
		case <-time.After(15 * time.Second):
		}
		runErr = ctx.Err()
	}
	// Collect the rest of the output (bounded, so a stuck stream cannot hold the run).
	select {
	case <-copied:
	case <-time.After(10 * time.Second):
	}
	oom := false
	ictx, cancel := context.WithTimeout(bg, 10*time.Second)
	if insp, err := cli.ContainerInspect(ictx, id); err == nil && insp.State != nil {
		oom = insp.State.OOMKilled
	}
	cancel()
	return exitCode, oom, runErr
}

// RemoveStale removes sandbox containers left behind by a crashed server.
func (d *DockerRunner) RemoveStale(ctx context.Context) (int, error) {
	cli, err := d.client()
	if err != nil {
		return 0, err
	}
	list, err := cli.ContainerList(ctx, container.ListOptions{All: true, Filters: filters.NewArgs(filters.Arg("label", LabelSandbox+"=1"))})
	if err != nil {
		return 0, wrapDaemonErr(err)
	}
	for _, c := range list {
		_ = cli.ContainerRemove(ctx, c.ID, container.RemoveOptions{Force: true, RemoveVolumes: true})
	}
	return len(list), nil
}

// ListSandboxContainers returns the ids of existing sandbox containers matching a label (tests).
func (d *DockerRunner) ListSandboxContainers(ctx context.Context, label string) ([]string, error) {
	cli, err := d.client()
	if err != nil {
		return nil, err
	}
	args := filters.NewArgs(filters.Arg("label", LabelSandbox+"=1"))
	if label != "" {
		args.Add("label", label)
	}
	list, err := cli.ContainerList(ctx, container.ListOptions{All: true, Filters: args})
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(list))
	for _, c := range list {
		ids = append(ids, c.ID)
	}
	return ids, nil
}

// ---------- engine ----------

// Engine runs specs with a hard time limit and cancellation, after checking the spec against
// the security policy.
type Engine struct {
	Runner Runner
	// AllowedRoot is the only host directory tree that may be bind-mounted (the data dir, as the
	// Docker daemon sees it).
	AllowedRoot string
}

// ValidateSpec is a last line of defence: even a bug elsewhere cannot produce a privileged
// mount or a container that mounts the Docker socket or the host filesystem.
func (e *Engine) ValidateSpec(spec Spec) error {
	if spec.Image == "" || len(spec.Cmd) == 0 {
		return errors.New("sandbox: image and command are required")
	}
	if spec.Limits.NanoCPUs <= 0 || spec.Limits.MemoryBytes <= 0 || spec.Limits.Pids <= 0 || spec.Limits.TmpfsBytes <= 0 {
		return errors.New("sandbox: CPU, memory, process and tmpfs limits are required")
	}
	root := filepath.Clean(e.AllowedRoot)
	for _, m := range spec.Mounts {
		src := filepath.Clean(m.Source)
		low := strings.ToLower(filepath.ToSlash(src))
		if strings.Contains(low, "docker.sock") || strings.Contains(low, "docker_engine") || strings.Contains(low, "dockerdesktoplinuxengine") {
			return fmt.Errorf("sandbox: refusing to mount the Docker socket (%s)", m.Source)
		}
		if root == "" || root == "." {
			return errors.New("sandbox: no allowed mount root configured")
		}
		rel, err := filepath.Rel(root, src)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
			return fmt.Errorf("sandbox: mount source %s is outside the per-run workspace", m.Source)
		}
		if m.Target == "/" || !strings.HasPrefix(m.Target, "/work") && m.Target != "/inputs" {
			return fmt.Errorf("sandbox: mount target %s is not allowed", m.Target)
		}
	}
	return nil
}

// Run executes the spec, killing it after timeout or when ctx is cancelled (context.Cause tells
// a researcher's cancel apart from a server shutdown).
func (e *Engine) Run(ctx context.Context, spec Spec, timeout time.Duration, stdout, stderr io.Writer) (Outcome, error) {
	out := Outcome{ExitCode: -1}
	if err := e.ValidateSpec(spec); err != nil {
		return out, err
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out.Started = time.Now()
	code, oom, err := e.Runner.Run(runCtx, spec, stdout, stderr)
	out.Finished = time.Now()
	out.ExitCode, out.OOMKilled = code, oom
	switch {
	case errors.Is(context.Cause(ctx), errCancelled):
		out.Cancelled, out.ExitCode = true, -1
		return out, nil
	case errors.Is(runCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil:
		out.TimedOut, out.ExitCode = true, -1
		return out, nil
	case err != nil:
		return out, err
	}
	return out, nil
}

// EffectiveLimits adapts the configured limits to the machine Docker actually runs on: never more
// CPUs than it has, and at most 75% of its memory, so the host stays responsive.
func EffectiveLimits(want Limits, hostCPUs int, hostMem int64) Limits {
	out := want
	if hostCPUs > 0 && out.NanoCPUs > int64(hostCPUs)*1e9 {
		out.NanoCPUs = int64(hostCPUs) * 1e9
	}
	if hostMem > 0 {
		capMem := hostMem * 3 / 4
		if out.MemoryBytes > capMem {
			out.MemoryBytes = capMem
		}
	}
	if out.TmpfsBytes > out.MemoryBytes/2 {
		out.TmpfsBytes = out.MemoryBytes / 2
	}
	return out
}
