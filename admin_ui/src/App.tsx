import { useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { ConfigProvider, Layout, Menu, theme, Typography } from 'antd';
import {
  DashboardOutlined,
  DatabaseOutlined,
  TeamOutlined,
  BranchesOutlined,
  ExperimentOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import DashboardPage from './components/DashboardPage';
import SourcesPage from './components/SourcesPage';
import SessionsPage from './components/SessionsPage';
import LineagePage from './components/LineagePage';
import SettingsPage from './components/SettingsPage';

const { Sider, Header, Content } = Layout;

const MENU_ITEMS: Array<{ key: string; icon: React.ReactNode; label: string; path: string; external?: boolean }> = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: 'Dashboard', path: '/' },
  { key: 'sources', icon: <DatabaseOutlined />, label: 'Sources', path: '/sources' },
  { key: 'sessions', icon: <TeamOutlined />, label: 'Sessions', path: '/sessions' },
  { key: 'lineage', icon: <BranchesOutlined />, label: 'Lineage', path: '/lineage' },
  { key: 'examples', icon: <ExperimentOutlined />, label: 'Examples', path: '/examples', external: true },
  { key: 'settings', icon: <SettingOutlined />, label: 'Settings', path: '/settings' },
];

function getSelectedKey(pathname: string): string {
  // Match longest path first
  const match = MENU_ITEMS.find((m) => m.path !== '/' && pathname.startsWith(m.path));
  return match?.key ?? 'dashboard';
}

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = getSelectedKey(location.pathname);
  const selectedLabel = MENU_ITEMS.find((m) => m.key === selectedKey)?.label ?? 'Dashboard';

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#58a6ff',
          colorBgContainer: '#161b22',
          colorBgElevated: '#1c2129',
          colorBgLayout: '#0f1117',
          colorBorder: '#30363d',
          borderRadius: 8,
        },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          breakpoint="lg"
          theme="dark"
          style={{ background: '#161b22' }}
        >
          <div style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid #30363d',
          }}>
            <Typography.Text strong style={{ color: '#58a6ff', fontSize: collapsed ? 14 : 16 }}>
              {collapsed ? 'MCP' : 'MCP Hub'}
            </Typography.Text>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            onClick={({ key }) => {
              const item = MENU_ITEMS.find((m) => m.key === key);
              if (!item) return;
              if (item.external) {
                window.location.href = item.path;
              } else {
                navigate(item.path);
              }
            }}
            items={MENU_ITEMS}
            style={{ background: 'transparent', borderRight: 'none' }}
          />
        </Sider>
        <Layout>
          <Header style={{
            background: '#161b22',
            borderBottom: '1px solid #30363d',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
          }}>
            <Typography.Title level={4} style={{ margin: 0, color: '#e1e4e8' }}>
              {selectedLabel}
            </Typography.Title>
          </Header>
          <Content style={{ padding: 24, overflow: 'auto' }}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/sources/*" element={<SourcesPage />} />
              <Route path="/sessions" element={<SessionsPage />} />
              <Route path="/lineage" element={<LineagePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
