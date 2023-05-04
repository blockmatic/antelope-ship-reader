// @denoify-ignore

import { makeThisModuleAnExecutableReplacer } from "denoify";
import { assert } from "tsafe";
import * as path from "path";

// deno-lint-ignore require-await
makeThisModuleAnExecutableReplacer(async ({
  parsedImportExportStatement,
  destDirPath,
}) => {
  switch (parsedImportExportStatement.parsedArgument.nodeModuleName) {
    case "@eosrio/node-abieos":
      {
        const match = parsedImportExportStatement.target?.match(
          /^\*\s+as\s+(.*)$/,
        );
        assert(!!match);

        return `import { AbiEos as ${match[1]} } from "../deno_dist/abieos.ts"`;
      }
      break;

    case "rxjs":
      {
        if (parsedImportExportStatement.statementType == "export") {
          return "// skip rxjs exports";
        }
      }
      break;

    case "p-queue":
      {
        const match = parsedImportExportStatement.target?.match(
          /^\*\s+as\s+(.*)$/,
        );

          if (parsedImportExportStatement.statementType == "import") {
            return `import PQueueModule from 'npm:${parsedImportExportStatement.parsedArgument.nodeModuleName}@6.6.2';
                  const ${parsedImportExportStatement.target} = PQueueModule.default;
              `
          }
      }
      break;
  }

  //The replacer should return undefined when we want to let denoify replace the statement
  return undefined;
});
