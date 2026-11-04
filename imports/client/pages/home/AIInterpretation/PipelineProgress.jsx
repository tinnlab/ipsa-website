import React from 'react';
import { Typography, Tooltip } from 'antd';
import {
    CheckCircleFilled,
    LoadingOutlined,
    ClockCircleOutlined,
    CloseCircleFilled
} from '@ant-design/icons';
import { pipelineStepNodes } from '/imports/utils/pipelineSteps';
import './PipelineProgress.less';

const { Text } = Typography;

const PipelineProgress = ({
    totalSteps = 6,
    currentStep = 0,
    currentMessage = '',
    stepsInfo = [],
    stepExecutionTimes = {},
    status = 'running'
}) => {
    // Order AND status both come from the declared stepsInfo order — see imports/utils/pipelineSteps
    // for why neither may be derived from the step NUMBERS (the meta pipeline runs 6 -> 8 -> 7).
    const stepNodes = pipelineStepNodes(stepsInfo, { totalSteps, currentStep, status });

    const getStepIcon = (stepStatus) => {
        switch (stepStatus) {
            case 'completed':
                return <CheckCircleFilled className="step-icon completed" />;
            case 'active':
                return <LoadingOutlined className="step-icon active" spin />;
            case 'failed':
                return <CloseCircleFilled className="step-icon failed" />;
            default:
                return <ClockCircleOutlined className="step-icon pending" />;
        }
    };

    const formatTime = (seconds) => {
        if (!seconds) return '';
        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        }
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(0);
        return `${mins}m ${secs}s`;
    };

    return (
        <div className="pipeline-progress">
            <div className="pipeline-container">
                {stepNodes.map((stepInfo, index) => {
                    const stepNumber = stepInfo.step;
                    const stepStatus = stepInfo.status;
                    const executionTime = stepExecutionTimes[`step${stepNumber}`];
                    // Positional, like everything else here: the connector after a node is filled
                    // once that node itself is behind the active one.
                    const connectorDone = stepStatus === 'completed';

                    return (
                        <React.Fragment key={stepNumber}>
                            {/* Step node */}
                            <div className={`step-node ${stepStatus}`}>
                                <Tooltip
                                    title={
                                        <div>
                                            <div><strong>{stepInfo.name}</strong></div>
                                            <div style={{ fontSize: 12, marginTop: 4 }}>
                                                {stepInfo.message}
                                            </div>
                                            {executionTime && (
                                                <div style={{ fontSize: 11, marginTop: 4, color: '#52c41a' }}>
                                                    Completed in {formatTime(executionTime)}
                                                </div>
                                            )}
                                        </div>
                                    }
                                    placement="top"
                                >
                                    <div className="step-circle">
                                        {getStepIcon(stepStatus)}
                                    </div>
                                </Tooltip>
                                <div className="step-label">
                                    <Text
                                        className={`step-name ${stepStatus}`}
                                        ellipsis={{ tooltip: stepInfo.name }}
                                    >
                                        {stepInfo.name}
                                    </Text>
                                    {executionTime && (
                                        <Text type="secondary" className="step-time">
                                            {formatTime(executionTime)}
                                        </Text>
                                    )}
                                </div>
                            </div>

                            {/* Connector line */}
                            {index < stepNodes.length - 1 && (
                                <div className={`step-connector ${connectorDone ? 'completed' : ''}`}>
                                    <div className="connector-line" />
                                    {connectorDone && (
                                        <div className="connector-fill" />
                                    )}
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Current step message */}
            {currentMessage && status === 'running' && (
                <div className="current-message">
                    <LoadingOutlined style={{ marginRight: 8 }} />
                    <Text>{currentMessage}</Text>
                </div>
            )}

            {/* Status messages */}
            {status === 'completed' && (
                <div className="status-message success">
                    <CheckCircleFilled style={{ marginRight: 8 }} />
                    <Text>Report generation completed successfully!</Text>
                </div>
            )}

            {status === 'failed' && (
                <div className="status-message error">
                    <CloseCircleFilled style={{ marginRight: 8 }} />
                    <Text>Report generation failed. Please try again.</Text>
                </div>
            )}
        </div>
    );
};

export default PipelineProgress;
