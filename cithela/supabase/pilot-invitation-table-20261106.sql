-- CITHELA · pilotos por invitación, sin alta comercial pública ni pagos.
-- Etapa 1: permisos únicamente en esquema privado y sin políticas para clientes.
CREATE TABLE IF NOT EXISTS cithela_private.cithela_pilot_invites (
 email text PRIMARY KEY
  CHECK (email=lower(btrim(email)) AND length(email) BETWEEN 5 AND 254),
 issued_by uuid NOT NULL REFERENCES auth.users(id),
 issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 expires_at timestamptz NOT NULL,
 redeemed_by uuid REFERENCES auth.users(id),
 redeemed_at timestamptz,
 revoked_at timestamptz,
 CHECK (expires_at>issued_at),
 CHECK ((redeemed_by IS NULL)=(redeemed_at IS NULL))
);
ALTER TABLE cithela_private.cithela_pilot_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_pilot_invites FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS cithela_pilot_invites_expires
 ON cithela_private.cithela_pilot_invites(expires_at)
 WHERE redeemed_at IS NULL AND revoked_at IS NULL;