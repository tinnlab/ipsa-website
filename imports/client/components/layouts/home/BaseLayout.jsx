// import React, { useMemo, useState } from 'react';
// import PropTypes from 'prop-types';
//
// import { Layout, Menu } from 'antd';
//
// import { NavLink, useLocation } from "react-router-dom";
//
// import './BaseLayout.style.less';
// import Logo from "../Logo";
// import ChatWidget from "../../chat-box";
//
// const { Header, Content, Footer } = Layout;
//
// export default ({ menus, children }) => {
//     const location = useLocation();
//     const [current, setCurrent] = useState(location.pathname);
//     const [openKeys, setOpenKeys] = useState([]);
//
//     const NavLinkWithActive = ({ to, activeClass, ...props }) => {
//         return (
//             <NavLink
//                 to={to}
//                 className={({ isActive }) => (isActive ? activeClass : undefined)}
//                 {...props}
//             />
//         );
//     };
//
//     const onOpenChange = (keys) => {
//         setOpenKeys(keys);
//     };
//
//     const menuItems = useMemo(() => {
//         const renderSubMenu = (subMenu, parentLink) => {
//             const isActive = `${urlPrefix}${parentLink}${subMenu.link}` === location.pathname;
//
//             return {
//                 key: `${urlPrefix}${subMenu.link}`,
//                 className: isActive ? "active" : "",
//                 label: (
//                     <NavLinkWithActive
//                         to={`${urlPrefix}${parentLink}${subMenu.link}`}
//                         activeClass="active"
//                     >
//                         {subMenu.title}
//                     </NavLinkWithActive>
//                 ),
//             };
//         };
//
//         const renderMenu = menu => {
//             const isActive = `${urlPrefix}${menu.link}` === location.pathname;
//
//             return {
//                 key: `${urlPrefix}${menu.link}`,
//                 className: isActive ? "active" : "",
//                 label: menu.children ? (
//                     <span>{menu.title}</span>
//                 ) : (
//                     <NavLinkWithActive
//                         to={`${urlPrefix}${menu.link}`}
//                         activeClass="active"
//                     >
//                         {menu.title}
//                     </NavLinkWithActive>
//                 ),
//                 children: menu.children?.map(subMenu => renderSubMenu(subMenu, menu.link)),
//             };
//         };
//
//         return menus.map(renderMenu);
//     }, [menus, location.pathname]);
//
//     const onClick = (e) => {
//         if (!e.key.includes('/')) {
//             e.preventDefault();
//         } else {
//             setCurrent(e.key);
//         }
//     };
//
//     return (
//         <Layout className="home-layout">
//             <Header className="header">
//                 <Logo />
//                 <Menu
//                     theme="light"
//                     onClick={onClick}
//                     selectedKeys={[current]}
//                     mode="horizontal"
//                     items={menuItems}
//                     openKeys={openKeys}
//                     onOpenChange={onOpenChange}
//                     triggerSubMenuAction="hover"
//                 />
//             </Header>
//             <Layout>
//                 <Content className="site-layout-content">{children}</Content>
//             </Layout>
//             <Footer className="footer">Bioinformatics Lab @ Wayne State University</Footer>
//             <ChatWidget />
//         </Layout>
//     );
// };

import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Layout, Dropdown, Space, Typography } from 'antd';
import { DownOutlined, MenuOutlined } from '@ant-design/icons';
import { NavLink, useLocation } from "react-router-dom";

import './BaseLayout.style.less';
import Logo from "../Logo";
import ChatSidePanel from "../../chat-box";

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

export default ({ menus, children, onMenuAction }) => {
    const location = useLocation();
    const [current, setCurrent] = useState(location.pathname);
    const [mobileMenuVisible, setMobileMenuVisible] = useState(false);

    const NavLinkWithActive = ({ to, activeClass, children, ...props }) => {
        return (
            <NavLink
                to={to}
                className={({ isActive }) => (isActive ? activeClass : undefined)}
                {...props}
            >
                {children}
            </NavLink>
        );
    };

    // Create dropdown items for submenus
    const createDropdownItems = (subMenus, parentLink) => {
        // antd paints its own hover background on the <li> (.ant-dropdown-menu-item:hover), and the
        // labels below paint a second, inset teal one — two stacked rectangles. rc-menu forwards an
        // item's `style` onto the <li>, and an inline style beats antd's :hover rule without a CSS
        // specificity fight, so zeroing antd's padding + background leaves the label as the single
        // highlight, filling the whole row.
        const itemStyle = { padding: 0, backgroundColor: 'transparent' };

        return subMenus.map(subMenu => {
            const fullPath = `${urlPrefix}${parentLink}${subMenu.link}`;
            const isActive = fullPath === location.pathname;

            // Handle action items (popup triggers)
            if (subMenu.action) {
                return {
                    key: `action-${subMenu.action}`,
                    style: itemStyle,
                    label: (
                        <div
                            onClick={() => onMenuAction && onMenuAction(subMenu.action)}
                            style={{
                                display: 'block',
                                padding: '8px 16px',
                                color: '#666',
                                fontWeight: 400,
                                textDecoration: 'none',
                                borderRadius: '6px',
                                transition: 'all 0.2s ease',
                                backgroundColor: 'transparent',
                                cursor: 'pointer'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(16, 80, 98, 0.05)';
                                e.currentTarget.style.color = '#105062';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = '#666';
                            }}
                        >
                            {subMenu.title}
                        </div>
                    )
                };
            }

            return {
                key: fullPath,
                style: itemStyle,
                label: (
                    <NavLinkWithActive
                        to={fullPath}
                        style={{
                            display: 'block',
                            padding: '8px 16px',
                            color: isActive ? '#105062' : '#666',
                            fontWeight: isActive ? 600 : 400,
                            textDecoration: 'none',
                            borderRadius: '6px',
                            transition: 'all 0.2s ease',
                            backgroundColor: isActive ? 'rgba(16, 80, 98, 0.1)' : 'transparent'
                        }}
                        onMouseEnter={(e) => {
                            if (!isActive) {
                                e.currentTarget.style.backgroundColor = 'rgba(16, 80, 98, 0.05)';
                                e.currentTarget.style.color = '#105062';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!isActive) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = '#666';
                            }
                        }}
                    >
                        {subMenu.title}
                    </NavLinkWithActive>
                )
            };
        });
    };

    const renderNavigationItems = () => {
        return menus.map(menu => {
            const fullPath = `${urlPrefix}${menu.link}`;
            const isActive = fullPath === location.pathname;
            const hasChildren = menu.children && menu.children.length > 0;

            if (hasChildren) {
                const dropdownItems = createDropdownItems(menu.children, menu.link);

                return (
                    <Dropdown
                        key={fullPath}
                        menu={{ items: dropdownItems }}
                        trigger={['hover']}
                        placement="bottomLeft"
                        overlayStyle={{
                            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                            borderRadius: '8px',
                            border: '1px solid #e8e8e8'
                        }}
                    >
                        <div
                            style={{
                                padding: '12px 20px',
                                cursor: 'pointer',
                                color: isActive ? '#105062' : '#333',
                                fontWeight: isActive ? 600 : 500,
                                fontSize: '15px',
                                borderRadius: '8px',
                                transition: 'all 0.3s ease',
                                backgroundColor: isActive ? 'rgba(16, 80, 98, 0.1)' : 'transparent',
                                border: isActive ? '1px solid rgba(16, 80, 98, 0.2)' : '1px solid transparent'
                            }}
                            onMouseEnter={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.backgroundColor = 'rgba(16, 80, 98, 0.05)';
                                    e.currentTarget.style.color = '#105062';
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                    e.currentTarget.style.color = '#333';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }
                            }}
                        >
                            <Space size={4}>
                                <Text>{menu.title}</Text>
                                <DownOutlined style={{ fontSize: '10px', opacity: 0.7 }} />
                            </Space>
                        </div>
                    </Dropdown>
                );
            }

            return (
                <NavLinkWithActive
                    key={fullPath}
                    to={fullPath}
                    style={{
                        padding: '12px 20px',
                        color: isActive ? '#105062' : '#333',
                        fontWeight: isActive ? 600 : 500,
                        fontSize: '15px',
                        textDecoration: 'none',
                        borderRadius: '8px',
                        transition: 'all 0.3s ease',
                        backgroundColor: isActive ? 'rgba(16, 80, 98, 0.1)' : 'transparent',
                        border: isActive ? '1px solid rgba(16, 80, 98, 0.2)' : '1px solid transparent',
                        display: 'block'
                    }}
                    onMouseEnter={(e) => {
                        if (!isActive) {
                            e.currentTarget.style.backgroundColor = 'rgba(16, 80, 98, 0.05)';
                            e.currentTarget.style.color = '#105062';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (!isActive) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = '#333';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }
                    }}
                >
                    {menu.title}
                </NavLinkWithActive>
            );
        });
    };

    return (
        <ChatSidePanel>
            <Layout className="home-layout">
                <Header
                    style={{
                        background: 'white',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        borderBottom: '1px solid #e8e8e8',
                        padding: '0 24px',
                        height: '70px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        position: 'sticky',
                        top: 0,
                        zIndex: 100
                    }}
                    className="header"
                >
                    {/* Logo Section */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Logo />
                    </div>

                    {/* Desktop Navigation */}
                    <nav
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                        className="desktop-nav"
                    >
                        {renderNavigationItems()}
                    </nav>

                    {/* Mobile Menu Button */}
                    <div
                        style={{
                            display: 'none'
                        }}
                        className="mobile-menu-toggle"
                    >
                        <Dropdown
                            menu={{
                                items: menus.map(menu => ({
                                    key: `${urlPrefix}${menu.link}`,
                                    label: (
                                        <NavLinkWithActive to={`${urlPrefix}${menu.link}`}>
                                            {menu.title}
                                        </NavLinkWithActive>
                                    )
                                }))
                            }}
                            trigger={['click']}
                            placement="bottomRight"
                        >
                            <MenuOutlined
                                style={{
                                    fontSize: '18px',
                                    cursor: 'pointer',
                                    padding: '8px',
                                    color: '#105062'
                                }}
                            />
                        </Dropdown>
                    </div>
                </Header>

                <Layout>
                    <Content
                        className="site-layout-content"
                        style={{
                            minHeight: 'calc(100vh - 70px - 60px)', // Adjust for header and footer
                            background: '#fafafa'
                        }}
                    >
                        {children}
                    </Content>
                </Layout>

                <Footer
                    style={{
                        textAlign: 'center',
                        background: 'linear-gradient(135deg, #105062 0%, #1a6c7a 100%)',
                        borderTop: 'none',
                        color: 'white',
                        fontSize: '14px',
                        height: '60px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 500,
                        boxShadow: '0 -2px 8px rgba(0,0,0,0.1)'
                    }}
                    className="footer"
                >
                    Bioinformatics Lab @ Wayne State University
                </Footer>
            </Layout>

            <style>{`
                @media (max-width: 768px) {
                    .desktop-nav {
                        display: none !important;
                    }
                    .mobile-menu-toggle {
                        display: block !important;
                    }
                }

                @media (min-width: 769px) {
                    .mobile-menu-toggle {
                        display: none !important;
                    }
                }
            `}</style>
        </ChatSidePanel>
    );
};