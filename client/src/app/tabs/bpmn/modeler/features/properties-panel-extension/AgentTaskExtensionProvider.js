import { createAgentTaskGroups as defaultAgentTaskGroups } from './props/AgentTaskGroup';


export default class AgentTaskExtensionProvider {

  constructor(propertiesPanel, createAgentTaskGroups = defaultAgentTaskGroups) {
    propertiesPanel.registerProvider(100, this);
    this.createAgentTaskGroups = createAgentTaskGroups;
  }

  getGroups(element) {
    return groups => {

      const hasAgentTaskGroup = groupExists(groups, 'agent_task') !== -1;

      if (!hasAgentTaskGroup) {
        const agentTaskGroups = this.createAgentTaskGroups(element);
        if (agentTaskGroups.length) {
          let adjacentIndex = groups.length - 2;
          groups.forEach((group, index) => {
            if (isAdjacentGroup(group)) {
              adjacentIndex = index + 1;
            }
          });

          groups.splice(adjacentIndex, 0, ...agentTaskGroups);
        }
      }

      return groups;
    };
  }
}

AgentTaskExtensionProvider.$inject = [ 'propertiesPanel' ];

function isAdjacentGroup(group) {

  // Position after subprocess-specific groups
  const adjacentGroupIds = [
    'CamundaPlatform__Subprocess',
    'subprocess',
    'ad_hoc_subprocess_active_tasks',
    'ad_hoc_subprocess_completion'
  ];
  return adjacentGroupIds.includes(group.id);
}

function groupExists(groups, groupId) {
  return groups.reduce((acc, group, index) => {
    return groupId === group.id ? index : acc;
  }, -1);
}
