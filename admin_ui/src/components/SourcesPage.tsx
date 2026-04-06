import { useState, useEffect, useCallback } from 'react';
import {
  Table, Tag, Button, Form, Input, Select, Switch, Popconfirm, Space, Statistic, Alert,
  Row, Col, Card, message, Tabs, Typography, Tooltip, Popover, Spin, List, Empty, theme,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined, LinkOutlined, DisconnectOutlined,
  DeleteOutlined, DownloadOutlined, SearchOutlined, DatabaseOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import type { SourceInfo, AddSourceParams, RegistryResult, DatabaseType, DatabaseTemplateParams, AdcStatus } from '../types';
import { usePolling } from '../hooks/usePolling';
import * as api from '../api/client';

const { Text } = Typography;
const { Search } = Input;

interface TemplateField {
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
  type?: 'password' | 'select' | 'switch';
  options?: Array<{ label: string; value: string }>;
  showWhen?: string; // field name that must be truthy to show this field
}

interface TemplateConfig {
  type: DatabaseType;
  title: string;
  description: string;
  color: string;
  needsAdc?: boolean;
  fields: TemplateField[];
}

const TEMPLATES: TemplateConfig[] = [
  {
    type: 'neo4j',
    title: 'Neo4j',
    description: 'Graph database — Cypher queries, schema extraction',
    color: '#018BFF',
    fields: [
      { name: 'uri', label: 'URI', placeholder: 'bolt://localhost:7687', required: true },
      { name: 'user', label: 'User', placeholder: 'neo4j', required: true },
      { name: 'password', label: 'Password', placeholder: 'password', type: 'password', required: true },
    ],
  },
  {
    type: 'spanner',
    title: 'Google Spanner',
    description: 'Relational + Property Graph — SQL, GQL via GRAPH_TABLE()',
    color: '#4285F4',
    needsAdc: true,
    fields: [
      { name: 'project', label: 'GCP Project', placeholder: 'my-gcp-project', required: true },
      { name: 'instance', label: 'Instance', placeholder: 'my-spanner-instance', required: true },
      { name: 'database', label: 'Database', placeholder: 'my-database', required: true },
      {
        name: 'dialect', label: 'Dialect', placeholder: 'googlesql', type: 'select',
        options: [
          { label: 'GoogleSQL (default)', value: 'googlesql' },
          { label: 'PostgreSQL', value: 'postgresql' },
        ],
      },
      { name: 'enablePropertyGraph', label: 'Enable Property Graph', placeholder: '', type: 'switch' },
      { name: 'graphName', label: 'Graph Name', placeholder: 'FinGraph', showWhen: 'enablePropertyGraph' },
    ],
  },
  {
    type: 'bigquery',
    title: 'BigQuery',
    description: 'Analytics + Property Graph — SQL, GQL via GRAPH_TABLE()',
    color: '#669DF6',
    needsAdc: true,
    fields: [
      { name: 'project', label: 'GCP Project', placeholder: 'my-gcp-project', required: true },
      { name: 'location', label: 'Location', placeholder: 'us (optional)' },
      { name: 'allowedDatasets', label: 'Allowed Datasets', placeholder: 'dataset1, dataset2 (comma separated, optional)' },
      { name: 'enablePropertyGraph', label: 'Enable Property Graph', placeholder: '', type: 'switch' },
      { name: 'graphName', label: 'Graph Name', placeholder: 'my_dataset.my_graph', showWhen: 'enablePropertyGraph' },
    ],
  },
];

export default function SourcesPage() {
  const { token } = theme.useToken();
  const [form] = Form.useForm<AddSourceParams>();
  const [transport, setTransport] = useState<'stdio' | 'sse'>('stdio');

  // Registry state
  const [regResults, setRegResults] = useState<RegistryResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  // Database template state
  const [addingDb, setAddingDb] = useState<string | null>(null);
  const [adcStatus, setAdcStatus] = useState<AdcStatus | null>(null);
  const [graphToggles, setGraphToggles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.getAdcStatus().then(setAdcStatus).catch(() => setAdcStatus({ available: false }));
  }, []);

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

  // ── Database template actions ──────────────────────────────────────

  const handleAddDatabase = async (template: TemplateConfig, values: Record<string, unknown>) => {
    setAddingDb(template.type);
    try {
      const params: DatabaseTemplateParams = { type: template.type, ...values };
      await api.addDatabaseSource(params);
      message.success(`${template.title} source added and toolbox enabled`);
      refresh();
    } catch (err) {
      message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddingDb(null);
    }
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
          {
            key: 'database',
            label: <span><DatabaseOutlined /> Database Templates</span>,
            children: (
              <div>
                {/* ADC Status Banner */}
                {adcStatus && (
                  <Alert
                    type={adcStatus.available ? 'success' : 'warning'}
                    showIcon
                    icon={adcStatus.available ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    message={
                      adcStatus.available
                        ? `GCP credentials detected (${adcStatus.method}${adcStatus.method === 'gcloud-adc' ? ' — gcloud auth application-default login' : ''})`
                        : 'GCP credentials not found — Spanner/BigQuery require ADC or service account'
                    }
                    description={
                      !adcStatus.available
                        ? 'Run "gcloud auth application-default login" or set GOOGLE_APPLICATION_CREDENTIALS in .env'
                        : undefined
                    }
                    style={{ marginBottom: 16 }}
                  />
                )}
                <Row gutter={[16, 16]}>
                  {TEMPLATES.map((tpl) => (
                    <Col xs={24} lg={8} key={tpl.type}>
                      <Card
                        title={
                          <span>
                            <DatabaseOutlined style={{ color: tpl.color, marginRight: 8 }} />
                            {tpl.title}
                            {tpl.needsAdc && adcStatus?.available && (
                              <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>ADC Ready</Tag>
                            )}
                          </span>
                        }
                        size="small"
                        style={{ borderTop: `2px solid ${tpl.color}` }}
                      >
                        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                          {tpl.description}
                        </Text>
                        <Form
                          layout="vertical"
                          size="small"
                          onFinish={(values) => handleAddDatabase(tpl, values)}
                        >
                          {tpl.fields.map((field) => {
                            // Hide conditional fields when their dependency is off
                            if (field.showWhen && !graphToggles[`${tpl.type}_${field.showWhen}`]) {
                              return null;
                            }
                            return (
                              <Form.Item
                                key={field.name}
                                name={field.name}
                                label={field.type !== 'switch' ? field.label : undefined}
                                valuePropName={field.type === 'switch' ? 'checked' : 'value'}
                                rules={field.required ? [{ required: true, message: `${field.label} is required` }] : []}
                              >
                                {field.type === 'password' ? (
                                  <Input.Password placeholder={field.placeholder} />
                                ) : field.type === 'select' ? (
                                  <Select placeholder={field.placeholder}>
                                    {field.options?.map((opt) => (
                                      <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
                                    ))}
                                  </Select>
                                ) : field.type === 'switch' ? (
                                  <Switch
                                    checkedChildren={field.label}
                                    unCheckedChildren={field.label}
                                    onChange={(checked) => setGraphToggles((prev) => ({ ...prev, [`${tpl.type}_${field.name}`]: checked }))}
                                  />
                                ) : (
                                  <Input placeholder={field.placeholder} />
                                )}
                              </Form.Item>
                            );
                          })}
                          <Button
                            type="primary"
                            htmlType="submit"
                            icon={<PlusOutlined />}
                            loading={addingDb === tpl.type}
                            disabled={tpl.needsAdc && !adcStatus?.available}
                            block
                          >
                            Add {tpl.title}
                          </Button>
                        </Form>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
