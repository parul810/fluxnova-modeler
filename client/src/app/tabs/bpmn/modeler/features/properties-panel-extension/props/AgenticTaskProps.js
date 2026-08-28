import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { isDefined } from 'min-dash';

import {
  TextFieldEntry,
  isTextFieldEntryEdited,
  CheckboxEntry,
  isCheckboxEntryEdited
} from '@bpmn-io/properties-panel';

import { useService } from 'bpmn-js-properties-panel';

export const AGENTIC_TASK_TEMPLATE_ID = 'org.fluxnova.example.AgenticTask';

export function AgenticTaskProps(props) {
  const { element } = props;

  if (!isAgenticTask(element)) {
    return [];
  }

  return [
    {
      id: 'maxAutonomySeconds',
      component: MaxAutonomySeconds,
      isEdited: isTextFieldEntryEdited
    },
    {
      id: 'evidenceRequired',
      component: EvidenceRequired,
      isEdited: isCheckboxEntryEdited
    },
    {
      id: 'agentDescription',
      component: AgentDescription,
      isEdited: isTextFieldEntryEdited
    }
  ];
}

export function isAgenticTask(element) {
  if (!is(element, 'bpmn:ServiceTask')) {
    return false;
  }

  const businessObject = getBusinessObject(element);
  return businessObject.get('camunda:modelerTemplate') === AGENTIC_TASK_TEMPLATE_ID;
}

function MaxAutonomySeconds(props) {
  const { element } = props;

  const commandStack = useService('commandStack');
  const bpmnFactory = useService('bpmnFactory');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const businessObject = getBusinessObject(element);

  const getValue = () => {
    const agentic = getAgenticElement(businessObject);
    const value = agentic ? agentic.get('maxAutonomySeconds') : undefined;
    return isDefined(value) ? String(value) : '';
  };

  const setValue = (value) => {
    const commands = [];
    const agentic = ensureAgenticElement(element, businessObject, bpmnFactory, commands);

    const trimmed = value && value.trim();
    const numeric = trimmed && /^[0-9]+$/.test(trimmed) ? Number(trimmed) : undefined;

    commands.push({
      cmd: 'element.updateModdleProperties',
      context: {
        element,
        moddleElement: agentic,
        properties: { maxAutonomySeconds: numeric }
      }
    });

    commandStack.execute('properties-panel.multi-command-executor', commands);
  };

  return TextFieldEntry({
    element,
    id: 'maxAutonomySeconds',
    label: translate('Max Autonomy Seconds'),
    getValue,
    setValue,
    debounce,
    description: translate('How long this agent may act on its own before it must hand back control. Whole number of seconds.')
  });
}

function EvidenceRequired(props) {
  const { element } = props;

  const commandStack = useService('commandStack');
  const bpmnFactory = useService('bpmnFactory');
  const translate = useService('translate');

  const businessObject = getBusinessObject(element);

  const getValue = () => {
    const agentic = getAgenticElement(businessObject);
    const value = agentic ? agentic.get('evidenceRequired') : undefined;
    return isDefined(value) ? value : true;
  };

  const setValue = (value) => {
    const commands = [];
    const agentic = ensureAgenticElement(element, businessObject, bpmnFactory, commands);

    commands.push({
      cmd: 'element.updateModdleProperties',
      context: {
        element,
        moddleElement: agentic,
        // default=true, persist only when false
        properties: { evidenceRequired: value === false ? false : undefined }
      }
    });

    commandStack.execute('properties-panel.multi-command-executor', commands);
  };

  return CheckboxEntry({
    element,
    id: 'evidenceRequired',
    label: translate('Evidence Required'),
    getValue,
    setValue,
    description: translate('Block this task from completing unless it has written a non-empty "agentEvidence" process variable')
  });
}

function AgentDescription(props) {
  const { element } = props;

  const commandStack = useService('commandStack');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const businessObject = getBusinessObject(element);

  const getValue = () => {
    const value = businessObject.get('agentDescription');
    return value || '';
  };

  const setValue = (value) => {
    commandStack.execute('element.updateModdleProperties', {
      element,
      moddleElement: businessObject,
      properties: {
        agentDescription: value && value.trim() ? value : undefined
      }
    });
  };

  return TextFieldEntry({
    element,
    id: 'agentDescription',
    label: translate('Notes'),
    getValue,
    setValue,
    debounce,
    description: translate('Your own notes on what this agent does. Not read by the engine.')
  });
}


// helper functions

function createElement(type, properties, parent, bpmnFactory) {
  const element = bpmnFactory.create(type, properties);

  if (parent) {
    element.$parent = parent;
  }

  return element;
}

function getExtensionElementsList(businessObject, type = undefined) {
  const extensionElements = businessObject.get('extensionElements');

  if (!extensionElements) {
    return [];
  }

  const values = extensionElements.get('values');

  if (!values || !values.length) {
    return [];
  }

  if (type) {
    return values.filter(value => is(value, type));
  }

  return values;
}

function getAgenticElement(businessObject) {
  return getExtensionElementsList(businessObject, 'agentic:Agentic')[0];
}

function ensureAgenticElement(element, businessObject, bpmnFactory, commands) {
  let extensionElements = businessObject.get('extensionElements');

  if (!extensionElements) {
    extensionElements = createElement(
      'bpmn:ExtensionElements',
      { values: [] },
      businessObject,
      bpmnFactory
    );

    commands.push({
      cmd: 'element.updateModdleProperties',
      context: {
        element,
        moddleElement: businessObject,
        properties: { extensionElements }
      }
    });
  }

  let agentic = getExtensionElementsList(businessObject, 'agentic:Agentic')[0];

  if (!agentic) {
    agentic = createElement(
      'agentic:Agentic',
      {},
      extensionElements,
      bpmnFactory
    );

    commands.push({
      cmd: 'element.updateModdleProperties',
      context: {
        element,
        moddleElement: extensionElements,
        properties: {
          values: [ ...(extensionElements.get('values') || []), agentic ]
        }
      }
    });
  }

  return agentic;
}
