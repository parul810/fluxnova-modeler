import { createAgenticTaskGroups as defaultAgenticTaskGroups } from './props/AgenticTaskGroup';


export default class AgenticTaskExtensionProvider {

  constructor(propertiesPanel, createAgenticTaskGroups = defaultAgenticTaskGroups) {
    propertiesPanel.registerProvider(100, this);
    this.createAgenticTaskGroups = createAgenticTaskGroups;
  }

  getGroups(element) {
    return groups => {

      const hasAgenticTaskGroup = groupExists(groups, 'agentic_task') !== -1;

      if (!hasAgenticTaskGroup) {
        const agenticTaskGroups = this.createAgenticTaskGroups(element);
        if (agenticTaskGroups.length) {
          groups.splice(groups.length - 2, 0, ...agenticTaskGroups);
        }
      }

      return groups;
    };
  }
}

AgenticTaskExtensionProvider.$inject = [ 'propertiesPanel' ];

function groupExists(groups, groupId) {
  return groups.reduce((acc, group, index) => {
    return groupId === group.id ? index : acc;
  }, -1);
}
