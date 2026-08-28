const MARKER_RUNNING = 'agentic-exec-running';
const MARKER_COMPLETED = 'agentic-exec-completed';
const MARKER_INCIDENT = 'agentic-exec-incident';

const STATE_MARKERS = [ MARKER_RUNNING, MARKER_COMPLETED, MARKER_INCIDENT ];

const INCIDENT_OVERLAY_TYPE = 'agentic-incident';

/**
 * Paints run/complete/incident execution state onto the canvas for whatever
 * ExecutionFeed is configured (real or {@link MockExecutionFeed}), using
 * bpmn-js's own canvas markers/overlays — not bpmn-js-tracking, which is a
 * UI-interaction telemetry library, not an execution-state renderer.
 */
export default function ExecutionTrackingFeature(canvas, overlays, elementRegistry, config) {
  const { executionFeed } = config || {};

  if (!executionFeed) {
    return;
  }

  function clearState(activityId) {
    STATE_MARKERS.forEach(marker => {
      if (canvas.hasMarker(activityId, marker)) {
        canvas.removeMarker(activityId, marker);
      }
    });

    overlays.remove({ element: activityId, type: INCIDENT_OVERLAY_TYPE });
  }

  function elementExists(activityId) {
    return Boolean(elementRegistry.get(activityId));
  }

  executionFeed.onActivityStarted((activityId) => {
    if (!elementExists(activityId)) {
      return;
    }
    clearState(activityId);
    canvas.addMarker(activityId, MARKER_RUNNING);
  });

  executionFeed.onActivityCompleted((activityId) => {
    if (!elementExists(activityId)) {
      return;
    }
    clearState(activityId);
    canvas.addMarker(activityId, MARKER_COMPLETED);
  });

  executionFeed.onIncident((activityId, message) => {
    if (!elementExists(activityId)) {
      return;
    }
    clearState(activityId);
    canvas.addMarker(activityId, MARKER_INCIDENT);

    const badge = document.createElement('div');
    badge.className = 'agentic-incident-badge';
    badge.title = message || 'Incident';
    badge.textContent = '!';

    overlays.add(activityId, INCIDENT_OVERLAY_TYPE, {
      position: { top: -8, right: -8 },
      html: badge
    });
  });
}

ExecutionTrackingFeature.$inject = [ 'canvas', 'overlays', 'elementRegistry', 'config.agenticTask' ];
