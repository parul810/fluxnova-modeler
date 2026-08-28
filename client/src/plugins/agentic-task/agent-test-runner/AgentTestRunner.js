/**
 * Interface for running a single Agentic Task's configuration in isolation,
 * without executing a full process instance. A real implementation would
 * call out to the engine/worker; {@link StubAgentTestRunner} fakes a result.
 */
export default class AgentTestRunner {

  /**
   * @param {{ agentTopic: string, maxAutonomySeconds: number, evidenceRequired: boolean, agentDescription: string }} config
   * @return {Promise<{ agentResult: string, agentConfidence: number, agentEvidence: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  run(config) {
    throw new Error('AgentTestRunner#run must be implemented by a subclass');
  }
}
