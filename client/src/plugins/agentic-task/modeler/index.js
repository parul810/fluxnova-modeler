import AgenticTaskRenderer from './AgenticTaskRenderer';
import AgenticTaskPopupMenuProvider from './AgenticTaskPopupMenuProvider';
import AgenticTaskPaletteProvider from './AgenticTaskPaletteProvider';
import ExecutionTrackingFeature from './ExecutionTrackingFeature';

export default {
  __init__: [
    'agenticTaskRenderer',
    'agenticTaskPopupMenuProvider',
    'agenticTaskPaletteProvider',
    'agenticTaskExecutionTracking'
  ],
  agenticTaskRenderer: [ 'type', AgenticTaskRenderer ],
  agenticTaskPopupMenuProvider: [ 'type', AgenticTaskPopupMenuProvider ],
  agenticTaskPaletteProvider: [ 'type', AgenticTaskPaletteProvider ],
  agenticTaskExecutionTracking: [ 'type', ExecutionTrackingFeature ]
};
