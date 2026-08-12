import React, {useState, useEffect} from 'react';
import {Card, Menu} from 'antd';

const MarkdownTableOfContents = ({headings}) => {
    const [selectedKey, setSelectedKey] = useState('');
    const [activeKey, setActiveKey] = useState('');

    // Track which heading is currently in view
    useEffect(() => {
        if (!headings || headings.length === 0) return;

        const observerOptions = {
            root: null,
            rootMargin: '-100px 0px -66%',
            threshold: 0
        };

        const observerCallback = (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setActiveKey(entry.target.id);
                }
            });
        };

        const observer = new IntersectionObserver(observerCallback, observerOptions);

        // Observe all heading elements
        headings.forEach(heading => {
            const element = document.getElementById(heading.id);
            if (element) {
                observer.observe(element);
            }
        });

        return () => observer.disconnect();
    }, [headings]);

    if (!headings || headings.length === 0) {
        return null;
    }

    const handleMenuClick = ({key}) => {
        const element = document.getElementById(key);

        if (element) {
            element.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
            setSelectedKey(key);
        }
    };

    // Helper to strip leading numbers from heading text (e.g., "1. Title" -> "Title")
    const stripLeadingNumbers = (text) => {
        return text.replace(/^\d+\.\s*/, '').trim();
    };

    // Convert headings to menu items (hierarchical structure for level 1 and 2)
    const buildMenuItems = (headings) => {
        return headings.map(heading => {
            const item = {
                key: heading.id,
                label: stripLeadingNumbers(heading.text), // Remove leading numbers for cleaner display
                style: {
                    fontSize: heading.level === 1 ? '13px' : '12px',
                    fontWeight: heading.level === 1 ? 600 : 400
                }
            };

            if (heading.children && heading.children.length > 0) {
                item.children = buildMenuItems(heading.children);
            }

            return item;
        });
    };

    const menuItems = buildMenuItems(headings);

    // Get all parent keys (level 1 headings with children) to expand by default
    const defaultOpenKeys = headings
        .filter(h => h.children && h.children.length > 0)
        .map(h => h.id);

    return (
        <Card
            size="small"
            title="Table of Contents"
            style={{
                position: 'sticky',
                top: 20,
                maxHeight: 'calc(100vh - 40px)',
                overflowY: 'auto'
            }}
            bodyStyle={{padding: 0}}
        >
            <Menu
                mode="inline"
                selectedKeys={[activeKey || selectedKey]}
                defaultOpenKeys={defaultOpenKeys}
                items={menuItems}
                onClick={handleMenuClick}
                style={{
                    border: 'none',
                    fontSize: '12px'
                }}
            />
        </Card>
    );
};

export default MarkdownTableOfContents;
