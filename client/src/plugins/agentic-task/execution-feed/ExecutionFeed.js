/**
 * Base interface for a source of runtime execution events for Agentic Task
 * elements on the canvas. A real implementation would connect to the engine
 * (e.g. over a WebSocket); {@link MockExecutionFeed} fires a scripted
 * sequence for demo/testing purposes without any live backend.
 */
export default class ExecutionFeed {

  constructor() {
    this._startedListeners = [];
    this._completedListeners = [];
    this._incidentListeners = [];
  }

  /**
   * @param {(activityId: string) => void} callback
   * @return {() => void} unsubscribe
   */
  onActivityStarted(callback) {
    return subscribe(this._startedListeners, callback);
  }

  /**
   * @param {(activityId: string) => void} callback
   * @return {() => void} unsubscribe
   */
  onActivityCompleted(callback) {
    return subscribe(this._completedListeners, callback);
  }

  /**
   * @param {(activityId: string, message: string) => void} callback
   * @return {() => void} unsubscribe
   */
  onIncident(callback) {
    return subscribe(this._incidentListeners, callback);
  }

  emitActivityStarted(activityId) {
    this._startedListeners.forEach(listener => listener(activityId));
  }

  emitActivityCompleted(activityId) {
    this._completedListeners.forEach(listener => listener(activityId));
  }

  emitIncident(activityId, message) {
    this._incidentListeners.forEach(listener => listener(activityId, message));
  }
}

function subscribe(listeners, callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  };
}
