import { useState, useCallback } from 'react';
import {
  Table, Tag, Button, Form, Input, Select, Popconfirm, Space, Statistic,
  Row, Col, Card, message, Tabs, Typography, Tooltip, Popover, Spin, List, Empty, theme,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined, LinkOutlined, DisconnectOutlined,
  DeleteOutlined, DownloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { SourceInfo, AddSourceParams, RegistryResult } from '../types';
import { usePolling } from '../hooks/usePolling';
import * as api from '../api/client';

const { Text } = Typography;
const { Search } = Input;

export default function SourcesPage() {
  const { token } = theme.useToken();
  const [form] = Form.useForm<AddSourceParams>();
  const [transport, setTransport] = useState<'stdio' | 'sse'>('stdio');

  // Registry state
  const [regResults, setRegResults] = useState<RegistryResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const fetchSources = useCallback((signal: AbortSignal) => {
    signal.throwIfAborted();
    return api.getSources();
  }, []);

  const { data: sources, loading, refresh } = usePolling(fetchSources, 10000);
  const list = sources ?? [];
  const connected = list.filter((s) => s.status === 'connected').length;

  // ── Source actions ──────────────────────────────────────────────────

  const handleConnect = async (name: string) => {
    try { await api.connectSource(name); message.success(`Connected: ${name}`); refresh(); }
    catch { message.error(`Failed to connect: ${name}`); }
  };
  const handleDisconnect = async (name: string) => {
    try { await api.disconnectSource(name); message.success(`Disconnected: ${name}`); refresh(); }
    catch { message.error(`Failed to disconnect: ${name}`); }
  };
  const handleRemove = async (name: string) => {
    try { await api.removeSource(name); message.success(`Removed: ${name}`); refresh(); }
    catch { message.error(`Failed to remove: ${name}`); }
  };
  const handleAdd = async (values: AddSourceParams) => {
    try {
      if (values.transport === 'stdio' && typeof values.args === 'string') {
        values.args = (values.args as unknown as string).split(/\s+/).filter(Boolean);
      }
      await api.addSource(values);
      message.success(`Added: ${values.name}`);
      form.resetFields();
      refresh();
    } catch (err) {
      message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ── Registry actions ───────────────────────────────────────────────

  const handleSearch = async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    try { setRegResults(await api.searchRegistry(q)); }
    catch { message.error('Search failed'); }
    finally { setSearching(false); }
  };
  const handleInstall = async (r: RegistryResult) => {
    const name = r.name || r.title || 'unknown';
    const pkg = r.package_name || r.npm_package || r.name;
    setInstalling(pkg);
    try { await api.installFromRegistry(name, pkg, r.description); message.success(`Installed: ${name}`); refresh(); }
    catch { message.error(`Install failed: ${name}`); }
    finally { setInstalling(null); }
  };

  // ── Table columns ─────────────────────────────────────────────────

  const statusOrder: Record<string, number> = { connected: 0, connecting: 1, error: 2, disconnected: 3 };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: SourceInfo, b: SourceInfo) => a.name.localeCompare(b.name),
      render: (name: string, record: SourceInfo) => (
        <div>
          <Text strong>{name}</Text>
          {record.description && (
            <Typography.Paragraph
              type="secondary"
              ellipsis={{ rows: 1, tooltip: record.description }}
              style={{ margin: 0, fontSize: 12 }}
            >
              {record.description}
            </Typography.Paragraph>
          )}
        </div>
      ),
    },
    {
      title: 'Transport',
      dataIndex: 'transport',
      key: 'transport',
      width: 100,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      sorter: (a: SourceInfo, b: SourceInfo) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9),
      filters: [
        { text: 'connected', value: 'connected' },
        { text: 'disconnected', value: 'disconnected' },
        { text: 'error', value: 'error' },
        { text: 'connecting', value: 'connecting' },
      ],
      onFilter: (value: unknown, record: SourceInfo) => record.status === value,
      render: (status: string, record: SourceInfo) => {
        const colorMap: Record<string, string> = {
          connected: 'green', error: 'red', connecting: 'gold', disconnected: 'default',
        };
        return (
          <div>
            <Tag color={colorMap[status] ?? 'default'}>{status}</Tag>
            {record.error && (
              <Tooltip title={record.error}>
                <div style={{ color: token.colorError, fontSize: 11, cursor: 'help' }}>
                  {record.error.slice(0, 40)}...
                </div>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: 'Tools',
      dataIndex: 'tools',
      key: 'tools',
      render: (tools: string[]) => {
        if (!tools.length) return <Text type="secondary">—</Text>;
        const visible = tools.slice(0, 3);
        const rest = tools.slice(3);
        return (
          <span>
            {visible.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}
            {rest.length > 0 && (
              <Popover content={rest.map((t) => <Tag key={t} style={{ margin: 2 }}>{t}</Tag>)} trigger="hover">
                <Tag style={{ cursor: 'pointer' }}>+{rest.length}</Tag>
              </Popover>
            )}
          </span>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: SourceInfo) => (
        <Space size="small">
          {record.status === 'connected' ? (
            <Button size="small" icon={<DisconnectOutlined />} danger onClick={() => handleDisconnect(record.name)}>
              Disconnect
            </Button>
          ) : (
            <Button size="small" icon={<LinkOutlined />} type="primary" onClick={() => handleConnect(record.name)}>
              Connect
            </Button>
          )}
          <Popconfirm title={`Remove "${record.name}"?`} onConfirm={() => handleRemove(record.name)}>
            <Button size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Header */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col>
          <Card size="small">
            <Statistic title="Connected" value={connected} suffix={`/ ${list.length}`} valueStyle={{ color: token.colorPrimary }} />
          </Card>
        </Col>
        <Col flex="auto" style={{ textAlign: 'right', paddingTop: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>Refresh</Button>
        </Col>
      </Row>

      {/* Sources table */}
      <Table
        dataSource={list}
        columns={columns}
        rowKey="name"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} sources` }}
        size="small"
        style={{ marginBottom: 24 }}
      />

      {/* Add Source + Registry */}
      <Tabs
        type="card"
        items={[
          {
            key: 'add',
            label: <span><PlusOutlined /> Add Source</span>,
            children: (
              <Card size="small">
                <Form form={form} layout="vertical" onFinish={handleAdd}>
                  <Row gutter={16}>
                    <Col xs={24} sm={12} lg={6}>
                      <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                        <Input placeholder="my-neo4j" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} lg={4}>
                      <Form.Item name="transport" label="Transport" initialValue="stdio">
                        <Select onChange={(v: 'stdio' | 'sse') => setTransport(v)}>
                          <Select.Option value="stdio">STDIO</Select.Option>
                          <Select.Option value="sse">SSE</Select.Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    {transport === 'stdio' ? (
                      <>
                        <Col xs={24} sm={8} lg={4}>
                          <Form.Item name="command" label="Command">
                            <Input placeholder="npx" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={16} lg={6}>
                          <Form.Item name="args" label="Args">
                            <Input placeholder="-y @modelcontextprotocol/server-xxx" />
                          </Form.Item>
                        </Col>
                      </>
                    ) : (
                      <Col xs={24} sm={24} lg={10}>
                        <Form.Item name="url" label="URL">
                          <Input placeholder="http://localhost:5000/sse" />
                        </Form.Item>
                      </Col>
                    )}
                    <Col xs={24} sm={12} lg={4}>
                      <Form.Item name="description" label="Description">
                        <Input placeholder="My data source" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>Add & Connect</Button>
                </Form>
              </Card>
            ),
          },
          {
            key: 'registry',
            label: <span><SearchOutlined /> MCP Registry</span>,
            children: (
              <Card size="small">
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Search and install MCP servers from the community registry.
                </Text>
                <Search
                  placeholder="Search: neo4j, postgres, slack, github..."
                  enterButton="Search"
                  loading={searching}
                  onSearch={handleSearch}
                  style={{ marginBottom: 16, maxWidth: 600 }}
                />
                {searching ? (
                  <Spin style={{ display: 'block', textAlign: 'center', padding: 40 }} />
                ) : regResults.length === 0 ? (
                  <Empty description="No results" />
                ) : (
                  <List
                    dataSource={regResults}
                    renderItem={(r) => {
                      const name = r.name || r.title || 'unknown';
                      const pkg = r.package_name || r.npm_package || r.name;
                      return (
                        <List.Item
                          actions={[
                            <Button key="install" type="primary" size="small" icon={<DownloadOutlined />}
                              loading={installing === pkg} onClick={() => handleInstall(r)}>
                              Install
                            </Button>,
                          ]}
                        >
                          <List.Item.Meta
                            title={<span style={{ color: token.colorPrimary }}>{name}</span>}
                            description={
                              <div>
                                <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                                  {r.description}
                                </Typography.Paragraph>
                                <Text code style={{ marginTop: 4 }}>{pkg}</Text>
                              </div>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
