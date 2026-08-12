import React, { useState } from 'react';
import { Popover, InputNumber, Button, Space, Typography, Tooltip } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useGlobalSettings } from '../../../../../contexts/GlobalSettingsContext';

const { Text } = Typography;

export default function GlobalSettingsPanel() {
  const { tempSettings, setTempSettings, applySettings, resetSettings, globalSettings } = useGlobalSettings();
  const [open, setOpen] = useState(false);

  const hasChanges = JSON.stringify(tempSettings) !== JSON.stringify(globalSettings);

  const handleApply = () => {
    applySettings();
    setOpen(false);
  };

  const content = (
    <div style={{ width: 400 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space size="large" wrap>
        <Space direction="vertical" size={2}>
          <Tooltip title="False Discovery Rate threshold for significance">
            <Text strong>FDR P-Value:</Text>
          </Tooltip>
          <InputNumber
            min={0}
            max={1}
            step={0.01}
            value={tempSettings.pValueFDR}
            onChange={(val) => setTempSettings({...tempSettings, pValueFDR: val})}
            style={{ width: 100 }}
          />
        </Space>

        <Space direction="vertical" size={2}>
          <Tooltip title="Raw p-value threshold">
            <Text strong>P-Value:</Text>
          </Tooltip>
          <InputNumber
            min={0}
            max={1}
            step={0.01}
            value={tempSettings.pValue}
            onChange={(val) => setTempSettings({...tempSettings, pValue: val})}
            style={{ width: 100 }}
          />
        </Space>

        <Space direction="vertical" size={2}>
          <Tooltip title="Absolute fold change threshold for DE genes">
            <Text strong>Fold Change:</Text>
          </Tooltip>
          <InputNumber
            min={0}
            step={0.1}
            value={tempSettings.foldChange}
            onChange={(val) => setTempSettings({...tempSettings, foldChange: val})}
            style={{ width: 100 }}
          />
        </Space>

        <Space direction="vertical" size={2}>
          <Tooltip title="Absolute enrichment score threshold for pathways">
            <Text strong>Enrichment Score:</Text>
          </Tooltip>
          <InputNumber
            min={0}
            step={0.1}
            value={tempSettings.enrichmentScore}
            onChange={(val) => setTempSettings({...tempSettings, enrichmentScore: val})}
            style={{ width: 100 }}
          />
        </Space>
        </Space>

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            onClick={resetSettings}
            disabled={!hasChanges}
          >
            Reset
          </Button>
          <Button
            type="primary"
            size="small"
            onClick={handleApply}
            disabled={!hasChanges}
          >
            Apply to All Plots
          </Button>
        </Space>
      </Space>
    </div>
  );

  return (
    <div style={{ position: 'fixed', top: 80, right: 24, zIndex: 1000 }}>
      <Popover
        content={content}
        title={
          <Space>
            <SettingOutlined />
            <span>Settings</span>
          </Space>
        }
        trigger="click"
        open={open}
        onOpenChange={setOpen}
        placement="bottomRight"
      >
        <Tooltip title="Settings" placement="left">
          <Button
            type="default"
            shape="circle"
            icon={<SettingOutlined />}
            size="large"
          />
        </Tooltip>
      </Popover>
    </div>
  );
}
