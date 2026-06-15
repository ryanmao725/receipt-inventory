import {
  SSMClient,
  GetParameterCommand,
  type GetParameterCommandOutput,
} from "@aws-sdk/client-ssm";

/** Injectable send so tests don't hit AWS. */
export type SsmSend = (command: GetParameterCommand) => Promise<GetParameterCommandOutput>;

const client = new SSMClient({});
const defaultSend: SsmSend = (command) => client.send(command);

let cached: string | undefined;

/** Test helper: clears the module-level cache. */
export function resetSpoonacularKeyCache(): void {
  cached = undefined;
}

/**
 * Resolves the Spoonacular API key from SSM (parameter named by
 * SPOONACULAR_PARAM_NAME), caching it for the lifetime of the execution
 * environment so warm invocations don't re-fetch.
 */
export async function getSpoonacularApiKey(send: SsmSend = defaultSend): Promise<string> {
  if (cached !== undefined) return cached;
  const name = process.env.SPOONACULAR_PARAM_NAME;
  if (!name) throw new Error("SPOONACULAR_PARAM_NAME is not set");
  const res = await send(new GetParameterCommand({ Name: name }));
  cached = res.Parameter?.Value ?? "";
  return cached;
}
