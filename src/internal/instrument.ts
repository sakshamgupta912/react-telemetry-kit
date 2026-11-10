import MagicString from "magic-string";
import ts from "typescript";

type SupportedFunction =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

interface Insertion {
  position: number;
  text: string;
  kind: "open" | "close" | "import";
  depth: number;
}

export interface InstrumentedSource {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
}

function isSupportedFunction(node: ts.Node): node is SupportedFunction {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isGenerator(node: SupportedFunction): boolean {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)) &&
    node.asteriskToken !== undefined
  );
}

function containsDirectEval(body: ts.ConciseBody): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "eval"
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(body);
  return found;
}

function hasAsmDirective(body: ts.ConciseBody): boolean {
  if (!ts.isBlock(body)) return false;
  for (const statement of body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      break;
    }
    if (statement.expression.text === "use asm") return true;
  }
  return false;
}

function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return "[computed]";
}

function functionName(node: SupportedFunction): string {
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    node.name
  ) {
    return node.name.text;
  }
  if (
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return propertyName(node.name);
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent)) return propertyName(parent.name);
  if (ts.isPropertyDeclaration(parent)) return propertyName(parent.name);
  return "anonymous";
}

function collectBindingNames(name: ts.BindingName, result: Set<string>): void {
  if (ts.isIdentifier(name)) {
    if (name.text !== "this") result.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, result);
  }
}

function parameterFactory(node: SupportedFunction): string {
  const names = new Set<string>();
  for (const parameter of node.parameters) collectBindingNames(parameter.name, names);
  if (names.size === 0) return "";
  const entries = [...names].map((name) => `[${JSON.stringify(name)}]:${name}`);
  return `,()=>({${entries.join(",")}})`;
}

function blockStart(body: ts.Block, sourceFile: ts.SourceFile): number {
  let position = body.getStart(sourceFile) + 1;
  for (const statement of body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      break;
    }
    position = statement.getEnd();
  }
  return position;
}

function compareInsertions(left: Insertion, right: Insertion): number {
  const order = { open: 0, close: 1, import: 2 };
  if (left.kind !== right.kind) return order[left.kind] - order[right.kind];
  if (left.kind === "open") return left.depth - right.depth;
  if (left.kind === "close") return right.depth - left.depth;
  return 0;
}

export function instrumentSource(code: string, relativePath: string): InstrumentedSource | null {
  const scriptKind = relativePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : relativePath.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : relativePath.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(relativePath, code, ts.ScriptTarget.Latest, true, scriptKind);
  const identifiers = new Set<string>();

  function collectIdentifiers(node: ts.Node): void {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, collectIdentifiers);
  }
  collectIdentifiers(sourceFile);

  function uniqueIdentifier(base: string): string {
    let candidate = base;
    let suffix = 0;
    while (identifiers.has(candidate)) candidate = `${base}${++suffix}`;
    identifiers.add(candidate);
    return candidate;
  }

  const startIdentifier = uniqueIdentifier("__rtkStart");
  const endIdentifier = uniqueIdentifier("__rtkEnd");
  const insertions: Insertion[] = [];

  function visit(node: ts.Node, depth: number): void {
    if (
      isSupportedFunction(node) &&
      node.body &&
      !isGenerator(node) &&
      !containsDirectEval(node.body) &&
      !hasAsmDirective(node.body)
    ) {
      const body = node.body;
      const name = functionName(node);
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const functionId = `${relativePath}:${position.line + 1}:${position.character + 1}:${name}`;
      const handle = uniqueIdentifier("__rtkInvocation");
      const startCall = `${startIdentifier}(${JSON.stringify(functionId)},${JSON.stringify(name)}${parameterFactory(node)})`;

      if (ts.isBlock(body)) {
        insertions.push({
          position: blockStart(body, sourceFile),
          text: `\n;const ${handle}=${startCall};try{`,
          kind: "open",
          depth,
        });
        insertions.push({
          position: body.getEnd() - 1,
          text: `\n}finally{${endIdentifier}(${handle});}\n`,
          kind: "close",
          depth,
        });
      } else {
        insertions.push({
          position: body.getStart(sourceFile),
          text: `{const ${handle}=${startCall};try{return (`,
          kind: "open",
          depth,
        });
        insertions.push({
          position: body.getEnd(),
          text: `);}finally{${endIdentifier}(${handle});}}`,
          kind: "close",
          depth,
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, depth + 1));
  }
  visit(sourceFile, 0);
  if (insertions.length === 0) return null;

  insertions.push({
    position: code.length,
    text: `\n;import {traceFunctionStart as ${startIdentifier},traceFunctionEnd as ${endIdentifier}} from "react-telemetry-kit/runtime";\n`,
    kind: "import",
    depth: 0,
  });

  const edits = new Map<number, Insertion[]>();
  for (const insertion of insertions) {
    const samePosition = edits.get(insertion.position) ?? [];
    samePosition.push(insertion);
    edits.set(insertion.position, samePosition);
  }
  const output = new MagicString(code);
  for (const [position, samePosition] of edits) {
    output.appendLeft(position, samePosition.sort(compareInsertions).map((edit) => edit.text).join(""));
  }
  return {
    code: output.toString(),
    map: output.generateMap({ source: relativePath, includeContent: true, hires: true }),
  };
}
