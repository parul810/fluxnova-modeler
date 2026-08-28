import AgentTestRunner from './AgentTestRunner';

const STUB_DELAY_MS = 800;

/**
 * Returns a fake result after a short delay. This is the deliverable for
 * this pass — no live backend involved. Swap for a real implementation once
 * the engine-facing test-run API exists.
 */
export default class StubAgentTestRunner extends AgentTestRunner {

  run(config) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          agentResult: `Stub run of topic "${config.agentTopic || '(not set)'}" completed.`,
          agentConfidence: 0.82,
          agentEvidence: config.evidenceRequired
            ? 'stub-evidence: no live backend connected, this is a placeholder result.'
            : ''
        });
      }, STUB_DELAY_MS);
    });
  }
}
