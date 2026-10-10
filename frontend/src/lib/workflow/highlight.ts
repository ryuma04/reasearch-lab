/** Tiny dependency-free syntax highlighter for the code viewer (Python, JSON, YAML, Markdown, shell). */

export type TokenKind = "kw" | "str" | "com" | "num" | "fn" | "key" | "plain";
export interface Token {
  text: string;
  kind: TokenKind;
}

export type Lang = "python" | "json" | "yaml" | "markdown" | "shell" | "text";

export function detectLang(path: string): Lang {
  const p = path.toLowerCase();
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".json") || p.endsWith(".ipynb")) return "json";
  if (/\.(ya?ml)$/.test(p)) return "yaml";
  if (p.endsWith(".md")) return "markdown";
  if (/\.(sh|bash)$/.test(p) || p.endsWith("dockerfile")) return "shell";
  return "text";
}

const PY_KW = new Set(("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda " +
  "nonlocal not or pass raise return try while with yield self").split(" "));
const SH_KW = new Set("if then else fi for do done while case esac function echo cd export source pip python RUN FROM COPY WORKDIR USER".split(" "));

const TOKEN = /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

export function highlightLine(line: string, lang: Lang): Token[] {
  if (lang === "text") return [{ text: line, kind: "plain" }];
  if (lang === "markdown") {
    if (/^\s{0,3}#{1,6}\s/.test(line)) return [{ text: line, kind: "kw" }];
    if (/^\s*[-*]\s/.test(line)) return [{ text: line.slice(0, line.indexOf(line.trim()[0]!) + 1), kind: "key" }, { text: line.slice(line.indexOf(line.trim()[0]!) + 1), kind: "plain" }];
    return [{ text: line, kind: "plain" }];
  }
  if (lang === "yaml") {
    const m = /^(\s*-?\s*)([A-Za-z0-9_.-]+)(:)(.*)$/.exec(line);
    if (m && !line.trim().startsWith("#")) {
      const rest = highlightLine(m[4]!, "json");
      return [{ text: m[1]! + m[2]!, kind: "key" }, { text: m[3]!, kind: "plain" }, ...rest];
    }
    if (line.trim().startsWith("#")) return [{ text: line, kind: "com" }];
    return highlightLine(line, "json");
  }
  const out: Token[] = [];
  const kws = lang === "python" ? PY_KW : lang === "shell" ? SH_KW : new Set(["true", "false", "null"]);
  let last = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), kind: "plain" });
    const [text, com, str, num, word] = m;
    if (com !== undefined) {
      if (lang === "json") out.push({ text, kind: "plain" });
      else out.push({ text, kind: "com" });
    } else if (str !== undefined) {
      out.push({ text, kind: lang === "json" && line.slice(m.index + text.length).trimStart().startsWith(":") ? "key" : "str" });
    } else if (num !== undefined) out.push({ text, kind: "num" });
    else if (word !== undefined) {
      const prev = line.slice(0, m.index).trimEnd();
      if (kws.has(word)) out.push({ text, kind: "kw" });
      else if (lang === "python" && /(def|class)$/.test(prev)) out.push({ text, kind: "fn" });
      else if (lang === "python" && line[m.index + text.length] === "(") out.push({ text, kind: "fn" });
      else out.push({ text, kind: "plain" });
    }
    last = m.index + text.length;
  }
  if (last < line.length) out.push({ text: line.slice(last), kind: "plain" });
  return out;
}

export const TOKEN_CLASS: Record<TokenKind, string> = {
  kw: "text-[#c4a7ff]",
  str: "text-[#9be0a5]",
  com: "text-white/40 italic",
  num: "text-[#ffc47d]",
  fn: "text-[#7cc4ff]",
  key: "text-[#7cc4ff]",
  plain: "",
};
