// I cant' get this import to work locally. The import in node_modules is
// javy/dist but esbuild requires the import to be javy/fs
//
// @ts-expect-error
import { readFileSync, writeFileSync, STDIO } from "javy/fs";
import {
  EmitHint,
  FunctionDeclaration,
  PropertyAssignment,
  NewLineKind,
  TypeNode,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
  addSyntheticLeadingComment,
  Node,
  NodeFlags,
  createPrinter,
  createSourceFile,
  factory,
  Expression,
  ParameterDeclaration,
} from "typescript";

import {
  GenerateRequest,
  GenerateResponse,
  Parameter,
  Column,
  File,
  Query,
  Schema,
} from "./gen/plugin/codegen_pb";

import { argName, colName } from "./drivers/utlis";
import { Driver as Sqlite3Driver } from "./drivers/better-sqlite3";
import { Driver as PgDriver } from "./drivers/pg";
import { Driver as PostgresDriver } from "./drivers/postgres";
import { Mysql2Options, Driver as MysqlDriver } from "./drivers/mysql2";

// Read input from stdin
const input = readInput();
// Call the function with the input
const result = codegen(input);
// Write the result to stdout
writeOutput(result);

interface Options {
  runtime?: string;
  driver?: string;
  mysql2?: Mysql2Options
}

interface Driver {
  preamble: (queries: Query[]) => Node[];
  columnType: (c?: Column) => TypeNode;
  execDecl: (
    name: string,
    text: string,
    iface: string | undefined,
    params: Parameter[]
  ) => Node;
  execlastidDecl: (
    name: string,
    text: string,
    iface: string | undefined,
    params: Parameter[]
  ) => Node;
  manyDecl: (
    name: string,
    text: string,
    argIface: string | undefined,
    returnIface: string,
    params: Parameter[],
    columns: Column[]
  ) => Node;
  oneDecl: (
    name: string,
    text: string,
    argIface: string | undefined,
    returnIface: string,
    params: Parameter[],
    columns: Column[]
  ) => Node;
}

function createNodeGenerator(options: Options): Driver {
  switch (options.driver) {
    case "mysql2": {
      return new MysqlDriver(options.mysql2);
    }
    case "pg": {
      return new PgDriver();
    }
    case "postgres": {
      return new PostgresDriver();
    }
    case "better-sqlite3": {
      return new Sqlite3Driver();
    }
  }
  throw new Error(`unknown driver: ${options.driver}`);
}

function codegen(input: GenerateRequest): GenerateResponse {
  let files = [];
  let options: Options = {};

  if (input.pluginOptions.length > 0) {
    const text = new TextDecoder().decode(input.pluginOptions);
    options = JSON.parse(text) as Options;
  }

  const driver = createNodeGenerator(options);

  // TODO: Verify options, parse them from protobuf honestly

  const querymap = new Map<string, Query[]>();

  for (const query of input.queries) {
    if (!querymap.has(query.filename)) {
      querymap.set(query.filename, []);
    }
    const qs = querymap.get(query.filename);
    qs?.push(query);
  }

  const createdEnums: Set<string> = new Set();

  for (const [filename, queries] of querymap.entries()) {
    const nodes = driver.preamble(queries);
    const queryNames: [string, string | undefined][] = [];

    for (const query of queries) {
      const colmap = new Map<string, number>();
      for (let column of query.columns) {
        if (!column.name) {
          continue;
        }
        const count = colmap.get(column.name) || 0;
        if (count > 0) {
          column.name = `${column.name}_${count + 1}`;
        }
        colmap.set(column.name, count + 1);
      }

      const lowerName = query.name[0].toLowerCase() + query.name.slice(1);
      const textName = `${lowerName}Query`;

      nodes.push(
        queryDecl(
          textName,
          `-- name: ${query.name} ${query.cmd}
${query.text}`
        )
      );

      let argIface = undefined;
      let returnIface = undefined;
      if (query.params.length > 0) {
        argIface = `${query.name}Args`;
        nodes.push(...argsDecl(argIface, driver, query.params, input.catalog?.schemas || [], createdEnums));
        queryNames.push([lowerName, argIface]);
      } else {
        queryNames.push([lowerName, undefined]);
      }
      if (query.columns.length > 0) {
        returnIface = `${query.name}Row`;
        nodes.push(...rowDecl(returnIface, driver, query.columns, input.catalog?.schemas || [], createdEnums));
      }

      switch (query.cmd) {
        case ":exec": {
          nodes.push(
            driver.execDecl(lowerName, textName, argIface, query.params)
          );
          break;
        }
        case ":execlastid": {
          nodes.push(
            driver.execlastidDecl(lowerName, textName, argIface, query.params)
          );
          break;
        }
        case ":one": {
          nodes.push(
            driver.oneDecl(
              lowerName,
              textName,
              argIface,
              returnIface ?? "void",
              query.params,
              query.columns
            )
          );
          break;
        }
        case ":many": {
          nodes.push(
            driver.manyDecl(
              lowerName,
              textName,
              argIface,
              returnIface ?? "void",
              query.params,
              query.columns
            )
          );
          break;
        }
      }
    }

    if (queryNames.length > 0) {
      nodes.push(createMakeQueriesFn(queryNames));
    }

    if (nodes) {
      files.push(
        new File({
          name: `${filename.replace(".", "_")}.ts`,
          contents: new TextEncoder().encode(printNode(nodes)),
        })
      );
    }
  }

  return new GenerateResponse({
    files: files,
  });
}

function createMakeQueriesFn(queryNames: [string, string | undefined][]) {
  const queryFunctions = queryNames.map(([name, argsIface]) => {
    const args: ParameterDeclaration[] = [];
    const callArgs: Expression[] = [factory.createIdentifier("db")];

    if (argsIface) {
      args.push(factory.createParameterDeclaration(
        undefined,
        undefined,
        "args",
        undefined,
        factory.createTypeReferenceNode(argsIface)
      ));

      callArgs.push(factory.createIdentifier("args"));
    }

    return factory.createPropertyAssignment(
      factory.createIdentifier(name),
      factory.createArrowFunction(
        undefined,
        undefined,
        args,
        undefined,
        factory.createToken(SyntaxKind.EqualsGreaterThanToken),
        factory.createCallExpression(
          factory.createIdentifier(name),
          undefined,
          callArgs,
        )
      )
    );
  });

  return factory.createFunctionDeclaration(
    [factory.createModifier(SyntaxKind.ExportKeyword), factory.createModifier(SyntaxKind.DefaultKeyword)],
    undefined,
    factory.createIdentifier("makeQueries"),
    undefined,
    [
      factory.createParameterDeclaration(
        undefined,
        undefined,
        "db",
        undefined,
        factory.createIndexedAccessTypeNode(
          factory.createTypeReferenceNode(
            factory.createIdentifier("Parameters"),
            [
              factory.createTypeQueryNode(
                factory.createIdentifier(queryNames[0][0])
              ),
            ]
          ),
          factory.createLiteralTypeNode(factory.createNumericLiteral(0)),
        ),
      ),
    ],
    undefined,
    factory.createBlock(
      [
        factory.createReturnStatement(
          factory.createObjectLiteralExpression(queryFunctions, true)
        ),
      ],
      true
    )
  );
}

// Read input from stdin
function readInput(): GenerateRequest {
  const buffer = readFileSync(STDIO.Stdin);
  return GenerateRequest.fromBinary(buffer);
}

function queryDecl(name: string, sql: string) {
  return factory.createVariableStatement(
    [factory.createToken(SyntaxKind.ExportKeyword)],
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          factory.createIdentifier(name),
          undefined,
          undefined,
          factory.createNoSubstitutionTemplateLiteral(sql, sql)
        ),
      ],
      NodeFlags.Const //| NodeFlags.Constant | NodeFlags.Constant
    )
  );
}

function argsDecl(
  name: string,
  driver: Driver,
  params: Parameter[],
  schemas: Schema[],
  createdEnums: Set<string>,
) {
  const res: Node[] = [];

  res.push(factory.createInterfaceDeclaration(
    [factory.createToken(SyntaxKind.ExportKeyword)],
    factory.createIdentifier(name),
    undefined,
    undefined,
    params.map((param, i) => {
      const [columnType, enumDecl] = detectEnumColumn(driver, param.column, schemas, createdEnums);
      if (enumDecl) {
        res.push(enumDecl);
      }

      return factory.createPropertySignature(
        undefined,
        factory.createIdentifier(argName(i, param.column)),
        undefined,
        driver.columnType(param.column)
      );
    })
  ));

  return res;
}

function titleCase(str: string) {
  return str[0].toUpperCase() + str.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function detectEnumColumn(
  driver: Driver,
  column: Column | undefined,
  schemas: Schema[],
  createdEnums: Set<string>,
): [TypeNode, Node | undefined] {
  let columnType = driver.columnType(column);

  for (const schema of schemas) {
    if (schema.name !== (column?.type?.schema || 'public')) {
      continue;
    }

    for (const e of schema.enums) {
      if (e.name !== column?.type?.name) {
        continue;
      }

      const typeName = `${titleCase(schema.name)}${titleCase(e.name)}`;

      let union: Node | undefined = undefined;

      if (!createdEnums.has(typeName)) {
        const unionTypeNode = factory.createUnionTypeNode(
          e.vals.map((status) =>
            factory.createLiteralTypeNode(factory.createStringLiteral(status))
          )
        );

        union = factory.createTypeAliasDeclaration(
          [factory.createModifier(SyntaxKind.ExportKeyword)],
          typeName,
          undefined,
          unionTypeNode,
        );

        createdEnums.add(typeName);
      }

      if (column?.notNull) {
        return [
          factory.createTypeReferenceNode(typeName, undefined),
          union,
        ];
      }

      return [
        factory.createUnionTypeNode([
          factory.createTypeReferenceNode(typeName, undefined),
          factory.createLiteralTypeNode(factory.createNull()),
        ]),
        union,
      ];
    }
  }

  return [columnType, undefined];
};

function rowDecl(
  name: string,
  driver: Driver,
  columns: Column[],
  schemas: Schema[],
  createdEnums: Set<string>,
) {
  const res: Node[] = [];

  res.push(
    factory.createInterfaceDeclaration(
      [factory.createToken(SyntaxKind.ExportKeyword)],
      factory.createIdentifier(name),
      undefined,
      undefined,
      columns.map((column, i) => {
        const [columnType, enumDecl] = detectEnumColumn(driver, column, schemas, createdEnums);

        if (enumDecl) {
          res.push(enumDecl);
        }

        return factory.createPropertySignature(
          undefined,
          factory.createIdentifier(colName(i, column)),
          undefined,
          columnType,
        );
      })
    )
  );

  return res;
}

function printNode(nodes: Node[]): string {
  // https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#creating-and-printing-a-typescript-ast
  const resultFile = createSourceFile(
    "file.ts",
    "",
    ScriptTarget.Latest,
    /*setParentNodes*/ false,
    ScriptKind.TS
  );
  const printer = createPrinter({ newLine: NewLineKind.LineFeed });
  let output = "// Code generated by sqlc. DO NOT EDIT.\n\n";
  for (let node of nodes) {
    output += printer.printNode(EmitHint.Unspecified, node, resultFile);
    output += "\n\n";
  }
  return output;
}

// Write output to stdout
function writeOutput(output: GenerateResponse) {
  const encodedOutput = output.toBinary();
  const buffer = new Uint8Array(encodedOutput);
  writeFileSync(STDIO.Stdout, buffer);
}
