import { AGENTIC_TASK_TEMPLATE_ID } from '../../../app/tabs/bpmn/modeler/features/properties-panel-extension/props/AgenticTaskProps';

const POPUP_MENU_ID = 'agentic-task-menu';
const POPUP_MENU_PRIORITY = 1500;

export default function AgenticTaskPopupMenuProvider(popupMenu, eventBus, elementTemplates, config) {
  this._elementTemplates = elementTemplates;
  this._config = config || {};

  popupMenu.registerProvider(POPUP_MENU_ID, POPUP_MENU_PRIORITY, this);

  eventBus.on('element.contextmenu', (event) => {
    const { element, originalEvent } = event;

    if (!isAgenticTaskElement(element, elementTemplates)) {
      return;
    }

    if (originalEvent && originalEvent.preventDefault) {
      originalEvent.preventDefault();
    }

    popupMenu.open(element, POPUP_MENU_ID, {
      x: originalEvent ? originalEvent.clientX : 0,
      y: originalEvent ? originalEvent.clientY : 0
    });
  });
}

AgenticTaskPopupMenuProvider.$inject = [ 'popupMenu', 'eventBus', 'elementTemplates', 'config.agenticTask' ];

AgenticTaskPopupMenuProvider.prototype.getPopupMenuEntries = function(element) {
  const { openAgentPlayground } = this._config;

  return {
    'agentic-task-open-playground': {
      label: 'Open Agent Playground',
      className: 'agentic-task-playground-entry',
      action: () => {
        if (openAgentPlayground) {
          openAgentPlayground(element);
        }
      }
    }
  };
};

function isAgenticTaskElement(element, elementTemplates) {
  if (!element || element.labelTarget) {
    return false;
  }

  const template = elementTemplates.get(element);
  return Boolean(template) && template.id === AGENTIC_TASK_TEMPLATE_ID;
}
