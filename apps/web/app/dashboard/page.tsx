'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

interface MetaAdAccount {
  id: string;
  accountId: string;
  name: string;
}

interface MetaAd {
  id: string;
  name: string;
  status?: string;
  creative?: {
    id: string;
    name?: string;
    title?: string;
    body?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    objectStoryId?: string;
  };
}

interface CreativeModalState {
  adId: string;
  adName: string;
  creative: NonNullable<MetaAd['creative']>;
}

interface MetaAdSet {
  id: string;
  name: string;
  status?: string;
  ads: MetaAd[];
}

interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  adsets: MetaAdSet[];
}

interface MetaHierarchy {
  accountId: string;
  range?: {
    since: string;
    until: string;
  };
  totals: {
    campaigns: number;
    adsets: number;
    ads: number;
  };
  campaigns: MetaCampaign[];
}

function defaultSinceDate() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [accountSearch, setAccountSearch] = useState<string>('');
  const [since, setSince] = useState<string>(defaultSinceDate());
  const [until, setUntil] = useState<string>(today());
  const [hierarchy, setHierarchy] = useState<MetaHierarchy | null>(null);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);
  const [isLoadingHierarchy, setIsLoadingHierarchy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [selectedCreative, setSelectedCreative] = useState<CreativeModalState | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccounts() {
      setIsLoadingAccounts(true);
      setError('');

      try {
        const response = await fetch('/api/meta/ad-accounts', {
          signal: controller.signal,
        });

        const payload = (await response.json()) as { data?: MetaAdAccount[]; message?: string };

        if (!response.ok || !payload.data) {
          throw new Error(payload.message ?? 'Failed to load ad accounts');
        }

        setAccounts(payload.data);
        if (payload.data.length > 0) {
          setSelectedAccount(payload.data[0]?.accountId ?? '');
        }
      } catch (loadError) {
        if ((loadError as { name?: string }).name === 'AbortError') {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Failed to load accounts.');
      } finally {
        setIsLoadingAccounts(false);
      }
    }

    void loadAccounts();
    return () => {
      controller.abort();
    };
  }, []);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) {
      return accounts;
    }

    return accounts.filter((account) => {
      return (
        account.name.toLowerCase().includes(query) ||
        account.accountId.toLowerCase().includes(query)
      );
    });
  }, [accountSearch, accounts]);

  const searchedAccountId = useMemo(() => {
    const query = accountSearch.trim();
    return /^\d+$/.test(query) ? query : '';
  }, [accountSearch]);

  const effectiveAccountId = useMemo(
    () => searchedAccountId || selectedAccount,
    [searchedAccountId, selectedAccount],
  );

  const canFetchHierarchy = useMemo(
    () => Boolean(effectiveAccountId && since && until),
    [effectiveAccountId, since, until],
  );

  async function loadHierarchy() {
    if (!canFetchHierarchy) {
      return;
    }

    setIsLoadingHierarchy(true);
    setError('');

    try {
      const params = new URLSearchParams({ since, until });
      const response = await fetch(
        `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/hierarchy?${params.toString()}`,
      );

      const payload = (await response.json()) as MetaHierarchy & { message?: string };

      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to load hierarchy');
      }

      setHierarchy(payload);
      setSelectedCreative(null);
    } catch (loadError) {
      setHierarchy(null);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load hierarchy.');
    } finally {
      setIsLoadingHierarchy(false);
    }
  }

  useEffect(() => {
    if (!selectedAccount) {
      return;
    }

    void loadHierarchy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  useEffect(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) {
      return;
    }

    const exactMatch = accounts.find((account) => {
      return (
        account.accountId.toLowerCase() === query ||
        account.name.toLowerCase() === query
      );
    });

    if (exactMatch && exactMatch.accountId !== selectedAccount) {
      setSelectedAccount(exactMatch.accountId);
    }
  }, [accountSearch, accounts, selectedAccount]);

  useEffect(() => {
    if (!selectedCreative) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedCreative(null);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedCreative]);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <h1>Meta Ads Hierarchy</h1>
          <p>Read-only Phase 1 dashboard using central system-user token through API.</p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="secondary-btn">Sign out</button>
        </form>
      </header>

      <section className="controls-card">
        <p className="muted">
          Accounts loaded: {accounts.length}
          {accountSearch.trim() ? ` | Matching search: ${filteredAccounts.length}` : ''}
          {searchedAccountId ? ` | Using typed ID: ${searchedAccountId}` : ''}
        </p>
        <div className="control-grid">
          <label>
            Ad account
            <input
              type="text"
              placeholder="Search by account ID or name"
              value={accountSearch}
              onChange={(event) => {
                setAccountSearch(event.target.value);
              }}
            />
          </label>
          <label>
            Select account
            <select
              value={selectedAccount}
              onChange={(event) => {
                setSelectedAccount(event.target.value);
              }}
              disabled={isLoadingAccounts || filteredAccounts.length === 0}
            >
              {filteredAccounts.map((account) => (
                <option key={account.id} value={account.accountId}>
                  {account.name} ({account.accountId})
                </option>
              ))}
            </select>
          </label>
          <label>
            Since
            <input
              type="date"
              value={since}
              onChange={(event) => {
                setSince(event.target.value);
              }}
            />
          </label>
          <label>
            Until
            <input
              type="date"
              value={until}
              onChange={(event) => {
                setUntil(event.target.value);
              }}
            />
          </label>
          <button type="button" onClick={() => void loadHierarchy()} disabled={!canFetchHierarchy || isLoadingHierarchy}>
            {isLoadingHierarchy ? 'Loading...' : 'Refresh hierarchy'}
          </button>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {hierarchy ? (
        <section className="table-card">
          <div className="summary-row">
            <span>Campaigns: {hierarchy.totals.campaigns}</span>
            <span>Ad sets: {hierarchy.totals.adsets}</span>
            <span>Ads: {hierarchy.totals.ads}</span>
            {hierarchy.range ? (
              <span>
                Range: {hierarchy.range.since} to {hierarchy.range.until}
              </span>
            ) : null}
          </div>

          <table>
            <thead>
              <tr>
                <th>Level</th>
                <th>Name</th>
                <th>ID</th>
                <th>Status</th>
                <th>Objective / Creative</th>
              </tr>
            </thead>
            <tbody>
              {hierarchy.campaigns.map((campaign) => (
                <Fragment key={`campaign-group-${campaign.id}`}>
                  <tr key={`campaign-${campaign.id}`}>
                    <td>Campaign</td>
                    <td>{campaign.name}</td>
                    <td>{campaign.id}</td>
                    <td>{campaign.status ?? '-'}</td>
                    <td>{campaign.objective ?? '-'}</td>
                  </tr>
                  {campaign.adsets.map((adset) => (
                    <Fragment key={`adset-group-${adset.id}`}>
                      <tr key={`adset-${adset.id}`}>
                        <td>Ad Set</td>
                        <td className="indent-1">{adset.name}</td>
                        <td>{adset.id}</td>
                        <td>{adset.status ?? '-'}</td>
                        <td>-</td>
                      </tr>
                      {adset.ads.map((ad) => (
                        <tr key={`ad-${ad.id}`}>
                          <td>Ad</td>
                          <td className="indent-2">{ad.name}</td>
                          <td>{ad.id}</td>
                          <td>{ad.status ?? '-'}</td>
                          <td>
                            {ad.creative
                              ? (
                                <button
                                  type="button"
                                  className="link-btn"
                                  onClick={() => {
                                    setSelectedCreative({
                                      adId: ad.id,
                                      adName: ad.name,
                                      creative: ad.creative!,
                                    });
                                  }}
                                >
                                  {ad.creative.name ?? 'Creative'} ({ad.creative.id})
                                </button>
                              )
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {selectedCreative ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            setSelectedCreative(null);
          }}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Creative details"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="modal-header">
              <h2>Creative Details</h2>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setSelectedCreative(null);
                }}
              >
                Close
              </button>
            </header>
            <div className="modal-content">
              <p><strong>Ad:</strong> {selectedCreative.adName} ({selectedCreative.adId})</p>
              <p><strong>Creative ID:</strong> {selectedCreative.creative.id}</p>
              <p><strong>Name:</strong> {selectedCreative.creative.name ?? '-'}</p>
              <p><strong>Title:</strong> {selectedCreative.creative.title ?? '-'}</p>
              <p><strong>Body:</strong> {selectedCreative.creative.body ?? '-'}</p>
              <p><strong>Object Story ID:</strong> {selectedCreative.creative.objectStoryId ?? '-'}</p>
              {selectedCreative.creative.imageUrl || selectedCreative.creative.thumbnailUrl ? (
                <img
                  src={selectedCreative.creative.imageUrl ?? selectedCreative.creative.thumbnailUrl}
                  alt={selectedCreative.creative.name ?? 'Creative preview'}
                  className="creative-preview"
                />
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
