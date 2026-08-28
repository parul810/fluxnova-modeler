import { AGENTIC_TASK_TEMPLATE_ID } from '../../../app/tabs/bpmn/modeler/features/properties-panel-extension/props/AgenticTaskProps';

const PALETTE_PRIORITY = 1100;

export default function AgenticTaskPaletteProvider(palette, create, elementTemplates, translate) {
  this._create = create;
  this._elementTemplates = elementTemplates;
  this._translate = translate;

  palette.registerProvider(PALETTE_PRIORITY, this);
}

AgenticTaskPaletteProvider.$inject = [ 'palette', 'create', 'elementTemplates', 'translate' ];

AgenticTaskPaletteProvider.prototype.getPaletteEntries = function() {
  const { _create: create, _elementTemplates: elementTemplates, _translate: translate } = this;

  function createListener(event) {
    const template = elementTemplates.get(AGENTIC_TASK_TEMPLATE_ID);

    if (!template) {
      return;
    }

    const element = elementTemplates.createElement(template);
    create.start(event, element);
  }

  return {
    'create.agentic-task': {
      group: 'activity',
      className: 'agentic-task-palette-icon',
      title: translate('Create Agentic Task'),
      action: {
        dragstart: createListener,
        click: createListener
      }
    }
  };
};
