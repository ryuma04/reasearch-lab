"use client";

import * as React from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Skeleton } from "@/components/ui/states";

const LANGUAGES: Record<string, string> = {
  py: "python", yaml: "yaml", yml: "yaml", json: "json", md: "markdown", toml: "ini", ini: "ini", cfg: "ini",
  txt: "plaintext", log: "plaintext", csv: "plaintext", xml: "xml", r: "r", sh: "shell",
};

export function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[ext] ?? "plaintext";
}

/**
 * VS Code's editor (Monaco via @monaco-editor/react): syntax highlighting, line numbers,
 * find/replace, multi-cursor, undo history per file. Ctrl/Cmd+S saves.
 */
export function CodeEditor({
  path, value, readOnly, onChange, onSave, height = "100%",
}: {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  height?: string | number;
}) {
  const saveRef = React.useRef(onSave);
  React.useEffect(() => { saveRef.current = onSave; }, [onSave]);
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 640px)");
    if (!mq) return;
    setNarrow(mq.matches);
    const on = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current?.());
  };

  return (
    <Editor
      // One model per file path: switching tabs keeps each file's undo history and cursor.
      path={path}
      height={height}
      language={languageFor(path)}
      value={value}
      theme="vs-dark"
      onChange={(v) => onChange?.(v ?? "")}
      onMount={onMount}
      loading={<Skeleton className="h-full w-full rounded-none" />}
      options={{
        readOnly,
        domReadOnly: readOnly,
        fontSize: narrow ? 12 : 13,
        lineNumbers: "on",
        minimap: { enabled: !narrow },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        wordWrap: languageFor(path) === "plaintext" ? "on" : "off",
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        padding: { top: 10 },
      }}
    />
  );
}
