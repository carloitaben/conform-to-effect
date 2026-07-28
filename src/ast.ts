import { SchemaAST } from "effect"

export function isStringLikeAst(ast: SchemaAST.AST): boolean {
  return (
    SchemaAST.isString(ast) ||
    (SchemaAST.isLiteral(ast) && typeof ast.literal === "string")
  )
}
