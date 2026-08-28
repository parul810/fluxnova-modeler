import React, { PureComponent } from 'react';

import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

import AgentPlaygroundPanel from './components/AgentPlaygroundPanel';
import StubAgentTestRunner from './agent-test-runner/StubAgentTestRunner';
import MockExecutionFeed from './execution-feed/MockExecutionFeed';

import additionalModule from './modeler';

import './agentic-task.less';

export default class AgenticTask extends PureComponent {

  constructor(props) {
    super(props);

    this.testRunner = new StubAgentTestRunner();
    this.executionFeed = new MockExecutionFeed();

    this.state = {
      activeTab: null,
      selectedElement: null,
      showPlayground: false
    };
  }

  async componentDidMount() {
    const { subscribe } = this.props;

    this.subscriptions = [
      subscribe('app.activeTabChanged', (...args) => this.handleActiveTabChanged(...args)),
      subscribe('bpmn.modeler.configure', (...args) => this.handleBpmnModelerConfigure(...args))
    ];
  }

  componentWillUnmount() {
    if (this.subscriptions && this.subscriptions.length) {
      this.subscriptions.forEach(subscription => subscription.cancel());
    }
    this.executionFeed.stop();
  }

  handleActiveTabChanged = ({ activeTab }) => {
    this.setState({ activeTab, showPlayground: false, selectedElement: null });
  };

  handleBpmnModelerConfigure = async ({ middlewares, tab }) => {

    if (!isBpmnTab(tab)) {
      return;
    }

    middlewares.push(config => {
      return {
        ...config,
        additionalModules: [
          ...config.additionalModules || [],
          additionalModule
        ],
        agenticTask: {
          ...config.agenticTask || {},
          openAgentPlayground: this.onOpen,
          executionFeed: this.executionFeed
        }
      };
    });
  };

  onOpen = (element) => {
    this.setState({
      showPlayground: true,
      selectedElement: element
    });
  };

  onClose = () => {
    this.setState({
      showPlayground: false
    });
  };

  render() {
    const { showPlayground, selectedElement } = this.state;

    if (!showPlayground || !selectedElement) {
      return null;
    }

    return (
      <AgentPlaygroundPanel
        element={ selectedElement }
        businessObject={ getBusinessObject(selectedElement) }
        testRunner={ this.testRunner }
        executionFeed={ this.executionFeed }
        onClose={ this.onClose } />
    );
  }
}


// helper /////////////////

function isBpmnTab(tab) {
  return tab && tab.type === 'bpmn';
}
