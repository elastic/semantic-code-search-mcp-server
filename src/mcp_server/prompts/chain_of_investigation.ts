import { z } from 'zod';
import { GetPromptResult } from '@modelcontextprotocol/sdk/types';

/**
 * The schema for the `start_chain_of_investigation` prompt.
 */
export const startChainOfInvestigationSchema = z.object({
  task: z.string().describe('The task you want to accomplish.'),
});

/**
 * The parameters for the `start_chain_of_investigation` prompt.
 */
export type StartChainOfInvestigationParams = z.infer<typeof startChainOfInvestigationSchema>;

/**
 * Creates a handler for the "start_chain_of_investigation" prompt.
 *
 * @param workflow The workflow text to be included in the prompt's response.
 * @returns An async function that takes the prompt parameters and returns a `PromptResult`.
 */
export function createStartChainOfInvestigationHandler(workflow: string) {
  return async function startChainOfInvestigation(
    params: StartChainOfInvestigationParams
  ): Promise<GetPromptResult> {
    const { task } = params;
    const responseText = `Use the workflow below to satisfy this task:\n\n${task}\n\n${workflow}`;
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: responseText,
          },
        },
      ],
    };
  };
}
