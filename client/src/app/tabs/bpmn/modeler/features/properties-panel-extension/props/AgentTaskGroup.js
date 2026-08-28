import { is } from 'bpmn-js/lib/util/ModelUtil';

import { AgentTaskProps } from './AgentTaskProps';


export function createAgentTaskGroups(element) {
  if (!is(element, 'bpmn:AdHocSubProcess')) {
    return [];
  }

  const agentTaskGroup = {
    id: 'agent_task',
    label: 'Agent Task',
    entries: [
      ...AgentTaskProps({ element })
    ]
  };

  return [ agentTaskGroup ];
}
