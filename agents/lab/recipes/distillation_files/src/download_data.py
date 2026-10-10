"""Install step (internet on): download the dataset named in configs/config.yaml into data/."""
import yaml
import torchvision

cfg = yaml.safe_load(open("configs/config.yaml"))
name = cfg["data"]["dataset"]
datasets = {"mnist": torchvision.datasets.MNIST, "fashion_mnist": torchvision.datasets.FashionMNIST}
if name not in datasets:
    raise SystemExit(f"unknown dataset {name}")
for train in (True, False):
    ds = datasets[name]("data", train=train, download=True)
    print(f"downloaded {name} {'train' if train else 'test'}: {len(ds)} images")
