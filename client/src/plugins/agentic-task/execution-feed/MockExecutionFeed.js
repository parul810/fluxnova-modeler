import ExecutionFeed from './ExecutionFeed';

/**
 * Fires a scripted sequence of execution events on a timer, so the canvas
 * highlighting can be demoed/tested with zero live engine connection.
 *
 * @example
 * new MockExecutionFeed([
 *   { activityId: 'Activity_1', event: 'started', delayMs: 300 },
 *   { activityId: 'Activity_1', event: 'completed', delayMs: 900 },
 *   { activityId: 'Activity_2', event: 'started', delayMs: 1200 },
 *   { activityId: 'Activity_2', event: 'incident', delayMs: 2000, message: 'Autonomy window exceeded' }
 * ]).start();
 */
export default class MockExecutionFeed extends ExecutionFeed {

  constructor(script = []) {
    super();
    this._script = script;
    this._timers = [];
  }

  /**
   * Replace the scripted sequence and start playing it immediately.
   * @param {Array} script
   */
  playScript(script) {
    this._script = script;
    this.start();
  }

  start() {
    this.stop();

    this._timers = this._script.map(step => setTimeout(() => {
      const { activityId, event, message } = step;

      if (event === 'started') {
        this.emitActivityStarted(activityId);
      } else if (event === 'completed') {
        this.emitActivityCompleted(activityId);
      } else if (event === 'incident') {
        this.emitIncident(activityId, message || 'Incident');
      }
    }, step.delayMs));
  }

  stop() {
    this._timers.forEach(timer => clearTimeout(timer));
    this._timers = [];
  }
}
