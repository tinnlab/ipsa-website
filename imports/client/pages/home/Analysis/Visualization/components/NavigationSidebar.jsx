import React, {useState, useEffect, useRef} from 'react';
import {Card, Menu} from 'antd';

const NavigationSidebar = ({sections, activeTab}) => {
    const [selectedKey, setSelectedKey] = useState('');
    const observerRef = useRef(null);
    const sectionsRef = useRef({});

    if (!sections || sections.length === 0) {
        return null;
    }

    const handleMenuClick = ({key}) => {
        const element = document.getElementById(key);

        if (element) {
            // Use scrollIntoView with the CSS scroll-margin-top we set
            element.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });

            setSelectedKey(key);
        } else {
            console.warn(`Element with id "${key}" not found in DOM`);
        }
    };

    // Set up IntersectionObserver for scroll-based highlighting
    useEffect(() => {
        // Cleanup previous observer
        if (observerRef.current) {
            observerRef.current.disconnect();
        }

        // Create new observer
        observerRef.current = new IntersectionObserver(
            (entries) => {
                // Track visible sections and their positions
                const visibleSections = [];

                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        visibleSections.push({
                            id: entry.target.id,
                            top: entry.boundingClientRect.top,
                            ratio: entry.intersectionRatio
                        });
                    }
                });

                // If we have visible sections, highlight the topmost one
                if (visibleSections.length > 0) {
                    // Sort by top position (closest to top of viewport)
                    visibleSections.sort((a, b) => a.top - b.top);
                    const topSection = visibleSections[0];

                    setSelectedKey(topSection.id);
                }
            },
            {
                // Account for sticky header (100px) and some buffer
                rootMargin: '-100px 0px -50% 0px',
                threshold: [0, 0.1, 0.5, 1.0]
            }
        );

        // Observe all section elements
        sections.forEach((section) => {
            const element = document.getElementById(section.id);
            if (element) {
                observerRef.current.observe(element);
                sectionsRef.current[section.id] = element;
            }
        });

        // Cleanup on unmount
        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, [sections]); // Re-run when sections change (e.g., tab switch)

    const menuItems = sections.map(section => ({
        key: section.id,
        label: section.title
    }));

    return (
        <Card
            size="small"
            title="Quick Navigation"
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
                selectedKeys={[selectedKey]}
                items={menuItems}
                onClick={handleMenuClick}
                style={{border: 'none'}}
            />
        </Card>
    );
};

export default NavigationSidebar;
