import React from 'react';
import { Typography, Tooltip } from 'antd';
import {
    CheckCircleFilled,
    LoadingOutlined,
    ClockCircleOutlined,
    CloseCircleFilled
} from '@ant-design/icons';
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
    const getStepStatus = (stepNumber) => {
        if (status === 'failed' && stepNumber === currentStep) {
            return 'failed';
        }
        if (stepNumber < currentStep) {
            return 'completed';
        }
        if (stepNumber === currentStep) {
            return 'active';
        }
        return 'pending';
    };

    const getStepIcon = (stepNumber) => {
        const stepStatus = getStepStatus(stepNumber);

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

    const getStepInfo = (stepNumber) => {
        return stepsInfo.find(s => s.step === stepNumber) || {
            step: stepNumber,
            name: `Step ${stepNumber}`,
            message: ''
        };
    };

    return (
        <div className="pipeline-progress">
            <div className="pipeline-container">
                {Array.from({ length: totalSteps }, (_, index) => {
                    const stepNumber = index + 1;
                    const stepInfo = getStepInfo(stepNumber);
                    const stepStatus = getStepStatus(stepNumber);
                    const executionTime = stepExecutionTimes[`step${stepNumber}`];

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
                                        {getStepIcon(stepNumber)}
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
                            {stepNumber < totalSteps && (
                                <div className={`step-connector ${stepNumber < currentStep ? 'completed' : ''}`}>
                                    <div className="connector-line" />
                                    {stepNumber < currentStep && (
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
