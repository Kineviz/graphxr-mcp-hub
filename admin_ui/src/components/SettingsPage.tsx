import { useEffect, useState, useRef } from 'react';
import { Input, Button, Space, message, Spin, Alert, theme } from 'antd';
import { ReloadOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import * as api from '../api/client';
import YAML from 'yaml';

const { TextArea } = Input;

export default function SettingsPage() {
  const { token } = theme.useToken();
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const originalRef = useRef('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getConfig();
      setRaw(data.raw);
      originalRef.current = data.raw;
      setParseError(null);
    } catch {
      message.error('Failed to load config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const dirty = raw !== originalRef.current;

  const handleChange = (value: string) => {
    setRaw(value);
    // Validate YAML on each change
    try {
      YAML.parse(value);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = YAML.parse(raw) as Record<string, unknown>;
    } catch (err) {
      message.error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    setSaving(true);
    try {
      const result = await api.putConfig(parsed);
      message.success(result.message || 'Config updated');
      originalRef.current = raw;
    } catch (err) {
      message.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setRaw(originalRef.current);
    setParseError(null);
  };

  if (loading) return <Spin size="large" style={{ display: 'block', textAlign: 'center', padding: 80 }} />;

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Reload</Button>
        <Button icon={<SaveOutlined />} type="primary" onClick={handleSave} loading={saving} disabled={!dirty || !!parseError}>
          Save {dirty ? '*' : ''}
        </Button>
        <Button icon={<UndoOutlined />} onClick={handleReset} disabled={!dirty}>Reset</Button>
      </Space>

      {parseError && (
        <Alert
          type="error"
          message="YAML Parse Error"
          description={parseError}
          style={{ marginBottom: 12 }}
          showIcon
        />
      )}

      {dirty && !parseError && (
        <Alert
          type="info"
          message="Unsaved changes"
          style={{ marginBottom: 12 }}
          showIcon
        />
      )}

      <TextArea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        rows={24}
        style={{
          fontFamily: 'Consolas, Monaco, monospace',
          fontSize: 13,
          background: token.colorBgLayout,
          color: token.colorText,
          border: `1px solid ${parseError ? token.colorError : token.colorBorder}`,
        }}
      />
    </div>
  );
}
