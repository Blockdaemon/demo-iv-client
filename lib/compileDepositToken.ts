import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import type { Abi, Hex } from 'viem';

const CONTRACT_FILE = 'NewBankDepositToken.sol';
const CONTRACT_NAME = 'NewBankDepositToken';
const projectRoot = path.resolve(__dirname, '..');
const contractPath = path.join(projectRoot, 'contracts', CONTRACT_FILE);

interface SolcError {
  formattedMessage: string;
  severity: 'error' | 'warning';
}

interface SolcContract {
  abi: Abi;
  evm: {
    bytecode: {
      object: string;
    };
  };
}

interface SolcOutput {
  contracts?: Record<string, Record<string, SolcContract>>;
  errors?: SolcError[];
}

export interface CompiledDepositToken {
  abi: Abi;
  bytecode: Hex;
}

function resolveImport(importPath: string): { contents?: string; error?: string } {
  const dependencyPath = path.resolve(projectRoot, 'node_modules', importPath);

  try {
    return { contents: fs.readFileSync(dependencyPath, 'utf8') };
  } catch {
    return { error: `Unable to resolve Solidity import: ${importPath}` };
  }
}

export function compileDepositToken(): CompiledDepositToken {
  const input = {
    language: 'Solidity',
    sources: {
      [CONTRACT_FILE]: {
        content: fs.readFileSync(contractPath, 'utf8'),
      },
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport })) as SolcOutput;
  const compilerErrors = output.errors?.filter(({ severity }) => severity === 'error') ?? [];
  if (compilerErrors.length > 0) {
    throw new Error(`Solidity compilation failed:\n${compilerErrors.map(({ formattedMessage }) => formattedMessage).join('\n')}`);
  }

  const contract = output.contracts?.[CONTRACT_FILE]?.[CONTRACT_NAME];
  if (!contract?.evm.bytecode.object) {
    throw new Error(`Solidity compiler did not emit bytecode for ${CONTRACT_NAME}`);
  }

  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}
