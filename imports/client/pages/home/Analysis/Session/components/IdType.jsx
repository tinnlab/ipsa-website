import React, { useState, useEffect } from "react";
import { Tracker } from "meteor/tracker";
import AnalysisUtils from "./AnalysisUtils";
import Select from "antd/lib/select";
import Space from "antd/lib/space";
import Text from "antd/lib/typography/Text";
import {Spin} from "antd";

export default ({ analysisId, inputType }) => {
    const [state, setState] = useState({
        idType: null,
        idTypes: [],
        isDetecting: false
    });

    // Set up reactive computations for idType and idTypes
    useEffect(() => {
        let detectionTimeout;

        const computation = Tracker.autorun(() => {
            const currentIdType = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'idType'
            })?.value;

            const availableIdTypes = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'idTypes'
            })?.value || [];

            // Check if we have input data but no idTypes yet (still detecting)
            const hasInput = inputType === 'expression' ?
                DBCollections.AnalysisConfig.findOne({analysisId, inputType, key: 'expressionFile'})?.value :
                DBCollections.AnalysisConfig.findOne({analysisId, inputType, key: 'input'})?.value;

            const hasIdTypes = availableIdTypes.length > 0;
            const isDetecting = hasInput && !hasIdTypes;

            // Show warning if detection takes more than 30 seconds
            if (isDetecting && !detectionTimeout) {
                detectionTimeout = setTimeout(() => {
                    console.warn('Gene ID type detection is taking longer than expected. This may indicate an issue with the server processing.');
                    notify.warning('Gene ID detection is taking longer than expected. Please check the server console for errors.');
                }, 30000);
            } else if (hasIdTypes && detectionTimeout) {
                clearTimeout(detectionTimeout);
                detectionTimeout = null;
            }

            setState(prev => ({
                idType: currentIdType !== undefined ? currentIdType : prev.idType,
                idTypes: availableIdTypes,
                isDetecting: isDetecting
            }));
        });

        // Cleanup computation when component unmounts
        return () => {
            computation.stop();
            if (detectionTimeout) {
                clearTimeout(detectionTimeout);
            }
        };
    }, [analysisId, inputType]);

    const handleIdTypeChange = (value) => {
        // Use nonreactive to prevent unnecessary reactivity
        Tracker.nonreactive(() => {
            setState(prev => ({
                ...prev,
                idType: value
            }));

            AnalysisUtils.updateAnalysis({
                analysisId,
                inputType,
                data: {
                    idType: value
                }
            });
        });
    };

    return (
        <Space direction="horizontal">
            <Text>Auto detected Gene ID type:</Text>
            {state.isDetecting ? (
                <Space>
                    <Spin size="small" />
                    <Text type="secondary">Detecting gene ID types from your data...</Text>
                </Space>
            ) : (
                <>
                    <Select
                        style={{ width: 400 }}
                        onChange={handleIdTypeChange}
                        value={state.idType && state.idTypes.length > 0 ? state.idType : undefined}
                        placeholder={state.idTypes.length === 0 ? "No gene ID types detected yet" : "Select a gene ID type"}
                        notFoundContent="No gene ID types available"
                    >
                        {state.idTypes.map((type, index) => (
                            <Select.Option key={index} value={type}>
                                {type}
                            </Select.Option>
                        ))}
                    </Select>
                    {state.idTypes.length > 0 && (
                        <Text type="success">✓ {state.idTypes.length} type{state.idTypes.length > 1 ? 's' : ''} detected</Text>
                    )}
                </>
            )}
            <span>
                Click <a
                    href={`${urlPrefix}/data-source`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    here
                </a> to see all supported ID types.
            </span>
        </Space>
    );
};