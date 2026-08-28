import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { isDefined } from 'min-dash';

import {
  TextFieldEntry,
  isTextFieldEntryEdited,
  CheckboxEntry,
  isCheckboxEntryEdited
} from '@bpmn-io/properties-panel';

import { useService } from 'bpmn-js-properties-panel';


export function AgentTaskProps(props) {
  const { element } = props;

  if (!is(element, 'bpmn:AdHocSubProcess')) {
    return [];
  }

  const businessObject = getBusinessObject(element);

  const entries = [
    {
      id: 'isAgentTask',
      component: IsAgentTask,
      isEdited: isCheckboxEntryEdited
    }
  ];

  if (businessObject.get('isAgentTask')) {
    entries.push({
      id: 'agentSystemPrompt',
      component: AgentSystemPrompt,
      isEdited: isTextFieldEntryEdited
    });
  }

  return entries;
}

function IsAgentTask(props) {
  const { element } = props;

  const commandStack = useService('commandStack');
  const translate = useService('translate');

  const businessObject = getBusinessObject(element);

  const getValue = () => {
    const value = businessObject.get('isAgentTask');
    return isDefined(value) ? value : false;
  };

  const setValue = (value) => {
    commandStack.execute('element.updateModdleProperties', {
      element,
      moddleElement: businessObject,
      properties: {
        isAgentTask: value ? true : undefined
      }
    });
  };

  return CheckboxEntry({
    element,
    id: 'isAgentTask',
    label: translate('Agent Task'),
    getValue,
    setValue,
    description: translate('Mark this ad hoc sub-process as an Agent Task. Drop service tasks inside it and apply the "Agent LLM Call" element template to configure the work it performs.')
  });
}

function AgentSystemPrompt(props) {
  const { element } = props;

  const commandStack = useService('commandStack');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const businessObject = getBusinessObject(element);

  const getValue = () => {
    const value = businessObject.get('agentSystemPrompt');
    return value || '';
  };

  const setValue = (value) => {
    commandStack.execute('element.updateModdleProperties', {
      element,
      moddleElement: businessObject,
      properties: {
        agentSystemPrompt: value && value.trim() ? value : undefined
      }
    });
  };

  return TextFieldEntry({
    element,
    id: 'agentSystemPrompt',
    label: translate('System Prompt'),
    getValue,
    setValue,
    debounce,
    description: translate('Default system prompt shared by the tasks inside this Agent Task')
  });
}
