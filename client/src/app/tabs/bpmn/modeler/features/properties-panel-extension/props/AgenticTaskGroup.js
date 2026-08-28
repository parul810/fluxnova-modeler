import { AgenticTaskProps, isAgenticTask } from './AgenticTaskProps';


export function createAgenticTaskGroups(element) {
  if (!isAgenticTask(element)) {
    return [];
  }

  const agenticTaskGroup = {
    id: 'agentic_task',
    label: 'Agentic Task',
    entries: [
      ...AgenticTaskProps({ element })
    ]
  };

  return [ agenticTaskGroup ];
}
