import JobExecutionExtensionProvider from './JobExecutionExtensionProvider';
import AdHocSubProcessExtensionProvider from './AdHocSubProcessExtensionProvider';
import AgentTaskExtensionProvider from './AgentTaskExtensionProvider';
import AgenticTaskExtensionProvider from './AgenticTaskExtensionProvider';

export default {
  __init__: [
    'bpmnJobExecutionExtensionProvider',
    'adHocSubProcessExtensionProvider',
    'agentTaskExtensionProvider',
    'agenticTaskExtensionProvider'
  ],
  bpmnJobExecutionExtensionProvider: [ 'type', JobExecutionExtensionProvider ],
  adHocSubProcessExtensionProvider: [ 'type', AdHocSubProcessExtensionProvider ],
  agentTaskExtensionProvider: [ 'type', AgentTaskExtensionProvider ],
  agenticTaskExtensionProvider: [ 'type', AgenticTaskExtensionProvider ]
};
