import inherits from 'inherits-browser';

import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { append as svgAppend, create as svgCreate } from 'tiny-svg';

import { AGENTIC_TASK_TEMPLATE_ID } from '../../../app/tabs/bpmn/modeler/features/properties-panel-extension/props/AgenticTaskProps';

// beats BpmnRenderer's default priority (1000) for the elements it matches
const AGENTIC_TASK_RENDER_PRIORITY = 1500;

const ACCENT_COLOR = '#446B8C';

export default function AgenticTaskRenderer(eventBus, bpmnRenderer, elementTemplates) {
  BaseRenderer.call(this, eventBus, AGENTIC_TASK_RENDER_PRIORITY);

  this._bpmnRenderer = bpmnRenderer;
  this._elementTemplates = elementTemplates;
}

inherits(AgenticTaskRenderer, BaseRenderer);

AgenticTaskRenderer.$inject = [ 'eventBus', 'bpmnRenderer', 'elementTemplates' ];

AgenticTaskRenderer.prototype.canRender = function(element) {
  return isAgenticTaskElement(element, this._elementTemplates);
};

AgenticTaskRenderer.prototype.drawShape = function(parentGfx, element) {

  // draw the ordinary service-task shape, then mark it as agentic
  const shape = this._bpmnRenderer.drawShape(parentGfx, element);

  shape.setAttribute('stroke', ACCENT_COLOR);
  shape.setAttribute('stroke-width', '2.5');

  const badge = svgCreate('circle', {
    cx: 12,
    cy: 12,
    r: 8,
    fill: ACCENT_COLOR,
    stroke: 'white',
    strokeWidth: 1.5
  });

  svgAppend(parentGfx, badge);

  return shape;
};

function isAgenticTaskElement(element, elementTemplates) {
  if (element.labelTarget) {
    return false;
  }

  const template = elementTemplates.get(element);
  return Boolean(template) && template.id === AGENTIC_TASK_TEMPLATE_ID;
}
