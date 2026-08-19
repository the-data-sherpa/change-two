import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4300";
const TEST_LOGIN_ENABLED = import.meta.env.VITE_TEST_LOGIN_ENABLED === "true";

interface UserIdentity {
  readonly displayName: string;
  readonly email: string;
  readonly id: string;
}

interface Organization {
  readonly id: string;
  readonly name: string;
}

type View =
  | { readonly kind: "loading" }
  | {
      readonly identities: readonly UserIdentity[];
      readonly kind: "select-identity";
    }
  | {
      readonly kind: "starter";
      readonly organizations: readonly Organization[];
      readonly user: UserIdentity;
    };

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [selectedOrganization, setSelectedOrganization] =
    useState<Organization | null>(null);

  useEffect(() => {
    void loadSession();
  }, []);

  async function loadSession(): Promise<void> {
    setError(null);
    const response = await fetch(`${API_URL}/session`, {
      credentials: "include",
    });
    if (response.status === 401) {
      if (!TEST_LOGIN_ENABLED) {
        setView({ identities: [], kind: "select-identity" });
        return;
      }
      const identitiesResponse = await fetch(`${API_URL}/test/identities`, {
        credentials: "include",
      });
      if (!identitiesResponse.ok) {
        setError(`Could not load test identities (HTTP ${identitiesResponse.status}).`);
        return;
      }
      const body = (await identitiesResponse.json()) as {
        readonly users: readonly UserIdentity[];
      };
      setView({ identities: body.users, kind: "select-identity" });
      return;
    }
    if (!response.ok) {
      setError(`Could not load the server session (HTTP ${response.status}).`);
      return;
    }
    const session = (await response.json()) as { readonly user: UserIdentity };
    const organizationsResponse = await fetch(`${API_URL}/organizations`, {
      credentials: "include",
    });
    if (!organizationsResponse.ok) {
      setError(
        `Could not load Organizations (HTTP ${organizationsResponse.status}).`,
      );
      return;
    }
    const organizations = (await organizationsResponse.json()) as {
      readonly organizations: readonly Organization[];
    };
    setSelectedOrganization(null);
    setView({
      kind: "starter",
      organizations: organizations.organizations,
      user: session.user,
    });
  }

  async function selectIdentity(userId: string): Promise<void> {
    setError(null);
    const response = await fetch(`${API_URL}/test/session`, {
      body: JSON.stringify({ userId }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      setError(`Could not establish the test session (HTTP ${response.status}).`);
      return;
    }
    await loadSession();
  }

  async function logout(): Promise<void> {
    const response = await fetch(`${API_URL}/session`, {
      credentials: "include",
      method: "DELETE",
    });
    if (!response.ok) {
      setError(`Could not clear the server session (HTTP ${response.status}).`);
      return;
    }
    await loadSession();
  }

  async function openOrganization(organizationId: string): Promise<void> {
    const response = await fetch(
      `${API_URL}/organizations/${encodeURIComponent(organizationId)}`,
      { credentials: "include" },
    );
    if (!response.ok) {
      setError(`Could not access the Organization (HTTP ${response.status}).`);
      return;
    }
    const body = (await response.json()) as {
      readonly organization: Organization;
    };
    setSelectedOrganization(body.organization);
  }

  return (
    <main>
      <p className="eyebrow">Season 0 starter</p>
      <h1>Change Two</h1>
      {error !== null && <p role="alert">{error}</p>}

      {view.kind === "loading" && <p className="summary">Loading starter…</p>}

      {view.kind === "select-identity" && (
        <section aria-labelledby="identity-heading">
          <h2 id="identity-heading">Select a test identity</h2>
          {!TEST_LOGIN_ENABLED ? (
            <p>Deterministic identity selection is disabled in this environment.</p>
          ) : (
            <ul className="identity-list">
              {view.identities.map((identity) => (
                <li key={identity.id}>
                  <button
                    data-testid={`identity-${identity.id}`}
                    onClick={() => void selectIdentity(identity.id)}
                    type="button"
                  >
                    <strong>{identity.displayName}</strong>
                    <span>{identity.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view.kind === "starter" && (
        <>
          <div className="session-heading">
            <div>
              <p className="label">Authenticated User</p>
              <p className="current-user">{view.user.displayName}</p>
            </div>
            <button className="secondary" onClick={() => void logout()} type="button">
              Log out
            </button>
          </div>

          <section aria-labelledby="organizations-heading">
            <h2 id="organizations-heading">Your Organizations</h2>
            <ul className="organization-list">
              {view.organizations.map((organization) => (
                <li key={organization.id}>
                  <button
                    onClick={() => void openOrganization(organization.id)}
                    type="button"
                  >
                    {organization.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {selectedOrganization !== null && (
            <p className="access-confirmation" role="status">
              Access confirmed for {selectedOrganization.name}.
            </p>
          )}

          <section aria-labelledby="support-inbox-heading" className="empty-surface">
            <h2 id="support-inbox-heading">Support inbox</h2>
            <p>
              This feature area is intentionally empty. The support inbox begins with
              Change 0.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
