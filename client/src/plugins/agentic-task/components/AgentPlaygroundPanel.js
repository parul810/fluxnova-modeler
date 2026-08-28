import React, { PureComponent } from 'react';

import { Modal } from '../../../shared/ui';

const RUN_STATE = {
  IDLE: 'idle',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error'
};

export default class AgentPlaygroundPanel extends PureComponent {

  constructor(props) {
    super(props);

    this.state = {
      runState: RUN_STATE.IDLE,
      result: null,
      error: null,
      mockPlaying: false
    };
  }

  getConfig() {
    const { businessObject } = this.props;

    const agentic = getAgenticElement(businessObject);

    return {
      agentTopic: businessObject.get('camunda:topic') || '',
      maxAutonomySeconds: agentic ? agentic.get('maxAutonomySeconds') : undefined,
      evidenceRequired: agentic ? (agentic.get('evidenceRequired') !== false) : true,
      agentDescription: businessObject.get('agentDescription') || ''
    };
  }

  runTest = () => {
    const { testRunner } = this.props;
    const config = this.getConfig();

    this.setState({ runState: RUN_STATE.RUNNING, result: null, error: null });

    testRunner.run(config).then(result => {
      this.setState({ runState: RUN_STATE.DONE, result });
    }).catch(error => {
      this.setState({ runState: RUN_STATE.ERROR, error: error.message || String(error) });
    });
  };

  playMockExecution = () => {
    const { executionFeed, businessObject } = this.props;
    const activityId = businessObject.get('id');

    this.setState({ mockPlaying: true });

    executionFeed.playScript([
      { activityId, event: 'started', delayMs: 200 },
      { activityId, event: 'completed', delayMs: 1400 }
    ]);

    setTimeout(() => this.setState({ mockPlaying: false }), 1500);
  };

  render() {
    const { onClose, businessObject } = this.props;
    const { runState, result, error, mockPlaying } = this.state;

    const config = this.getConfig();

    return (
      <Modal className="agent-playground-panel" onClose={ onClose }>
        <Modal.Title>Agent Playground — { businessObject.get('name') || businessObject.get('id') }</Modal.Title>

        <Modal.Body>
          <dl className="agent-playground-fields">
            <dt>Topic</dt>
            <dd>{ config.agentTopic || <em>not set</em> }</dd>

            <dt>Max Autonomy Seconds</dt>
            <dd>{ isDefined(config.maxAutonomySeconds) ? config.maxAutonomySeconds : <em>not set</em> }</dd>

            <dt>Evidence Required</dt>
            <dd>{ config.evidenceRequired ? 'Yes' : 'No' }</dd>

            <dt>Notes</dt>
            <dd>{ config.agentDescription || <em>none</em> }</dd>
          </dl>

          <div className="agent-playground-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={ runState === RUN_STATE.RUNNING }
              onClick={ this.runTest }
            >
              { runState === RUN_STATE.RUNNING ? 'Running…' : 'Run test' }
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              disabled={ mockPlaying }
              onClick={ this.playMockExecution }
            >
              { mockPlaying ? 'Playing…' : 'Play mock execution' }
            </button>
          </div>

          { runState === RUN_STATE.DONE && result && (
            <div className="agent-playground-result">
              <h4>Result</h4>
              <dl>
                <dt>agentResult</dt>
                <dd>{ result.agentResult }</dd>
                <dt>agentConfidence</dt>
                <dd>{ result.agentConfidence }</dd>
                <dt>agentEvidence</dt>
                <dd>{ result.agentEvidence || <em>(empty)</em> }</dd>
              </dl>
            </div>
          ) }

          { runState === RUN_STATE.ERROR && (
            <div className="agent-playground-error">{ error }</div>
          ) }
        </Modal.Body>

        <Modal.Footer>
          <button type="button" className="btn btn-secondary" onClick={ onClose }>Close</button>
        </Modal.Footer>
      </Modal>
    );
  }
}


// helpers /////////////////

function isDefined(value) {
  return value !== undefined && value !== null;
}

function getAgenticElement(businessObject) {
  const extensionElements = businessObject.get('extensionElements');

  if (!extensionElements) {
    return null;
  }

  const values = extensionElements.get('values') || [];

  return values.find(value => value.$type === 'agentic:Agentic') || null;
}
