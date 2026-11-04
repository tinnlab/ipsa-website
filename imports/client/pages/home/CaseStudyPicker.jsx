import React, {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Button, Modal, Select, Space, Typography} from 'antd';

const {Paragraph, Text} = Typography;

// "View Example": pick one of the deployment's case studies and go and get a copy of it.
//
// This deliberately does NOT call share.import itself. It navigates to /import/<shareId> — the
// ordinary share-link landing page — because that page already solves every hard part of this:
//
//   - the guest-account race (every visitor is auto-logged-in asynchronously at startup, so a cold
//     first visit has no userId at render time, and share.import requires one),
//   - live progress for a clone that can take a minute (share.import.progress + ShareImportProgress),
//   - share.import's 5/min rate limit, surfaced as a readable error,
//   - a preview, so nobody gets a study in their account merely by clicking.
//
// Reimplementing any of that here would be a second copy of logic that is already correct.
export default ({open, onClose, caseStudies}) => {
    const navigate = useNavigate();
    const [selected, setSelected] = useState(null);

    // Default to the first entry so the primary action is never a no-op on open. Re-runs when the
    // list arrives, since the modal can be opened before the method resolves.
    useEffect(() => {
        if (!selected && caseStudies.length > 0) setSelected(caseStudies[0].shareId);
    }, [caseStudies, selected]);

    const handleOpenExample = () => {
        if (!selected) return;
        onClose();
        navigate(`${window.urlPrefix || ''}/import/${selected}`);
    };

    return (
        <Modal
            title="View an example study"
            open={open}
            onCancel={onClose}
            footer={null}
            width={520}
        >
            <Space direction="vertical" size="middle" style={{width: '100%'}}>
                <Paragraph style={{marginBottom: 0}}>
                    Choose an example to open. You will get your own full copy — including the input
                    data — which you can explore, re-run and edit. Nothing you do to it affects the
                    original.
                </Paragraph>

                <div>
                    <Text strong>Example study</Text>
                    <Select
                        style={{width: '100%', marginTop: 8}}
                        value={selected}
                        onChange={setSelected}
                        options={caseStudies.map(({shareId, label}) => ({value: shareId, label}))}
                        placeholder="Choose an example"
                    />
                </div>

                <Button type="primary" onClick={handleOpenExample} disabled={!selected} block>
                    Open example
                </Button>
            </Space>
        </Modal>
    );
};
