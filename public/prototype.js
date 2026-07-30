(() => {
  "use strict";

  const communities = [
    {
      id: "agent-commons",
      adoptionPubkeys: 41,
      adoptionRepos: 3,
      probesTotal: 30,
      probesSuccessful: 30,
      metadataTended: "4 days ago",
      name: "Agent Commons",
      focusArea: "AI & agents",
      summary: "Open agent infrastructure, evaluation methods, and shared tooling.",
      about: "A working group for people building public agent infrastructure. Members share experiments, review tools, and maintain reusable evaluation datasets.",
      tags: ["Agents", "Open source", "Evaluation"],
      rating: 4.8,
      ratings: 86,
      relayOpens: 312,
      activity: 98,
      activityLabel: "Very active",
      activityAsOf: "Example: 2 days ago",
      listedAt: "2026-03-14",
      score: 96,
      quality: 94,
      momentum: 98,
      verified: true,
      claimed: true,
      access: "public",
      probedAgo: "2h ago",
      currentWork: "Maintaining an open evaluation dataset for interoperable agents.",
      whyRanked: "Ranks highly because the example combines sustained recent activity, frequent updates, and strong join interest.",
      evidenceLimit: "Activity is illustrative and operator-reported; no private relay content was inspected."
    },
    {
      id: "prompt-forge",
      adoptionPubkeys: 27,
      adoptionRepos: 2,
      probesTotal: 30,
      probesSuccessful: 29,
      metadataTended: "yesterday",
      name: "Prompt Forge",
      focusArea: "AI & agents",
      summary: "A practical workshop for testing prompts, tools, and agent behavior.",
      about: "A workshop community for builders who want repeatable prompt and tool evaluation. The group publishes test cases and hosts weekly critique sessions.",
      tags: ["Prompting", "Tool use", "Testing"],
      rating: 4.7,
      ratings: 64,
      relayOpens: 241,
      activity: 91,
      activityLabel: "Very active",
      activityAsOf: "Example: 3 days ago",
      listedAt: "2025-12-08",
      score: 90,
      quality: 90,
      momentum: 91,
      verified: true,
      claimed: true,
      access: "invite",
      probedAgo: "4h ago",
      currentWork: "Publishing a shared prompt regression suite and weekly critique notes.",
      whyRanked: "The example score reflects fresh operator updates and sustained relay-link interest.",
      evidenceLimit: "Activity is illustrative; public rankings are not live yet."
    },
    {
      id: "open-research",
      adoptionPubkeys: 12,
      adoptionRepos: 1,
      probesTotal: 30,
      probesSuccessful: 28,
      metadataTended: "2 weeks ago",
      name: "Open Research Guild",
      focusArea: "Research & knowledge",
      summary: "Collaborative literature reviews and open replication projects.",
      about: "Open Research Guild coordinates collaborative reviews, replication projects, and public research notes across technical and social science topics.",
      tags: ["Research", "Replication", "Datasets"],
      rating: 4.9,
      ratings: 38,
      relayOpens: 154,
      activity: 82,
      activityLabel: "Active",
      activityAsOf: "Example: 5 days ago",
      listedAt: "2026-04-23",
      score: 84,
      quality: 93,
      momentum: 78,
      verified: true,
      claimed: false,
      access: "public",
      probedAgo: "9h ago",
      currentWork: "Coordinating an open replication sprint across three public datasets.",
      whyRanked: "Steady example activity is tempered by a smaller evidence sample and lower recent momentum.",
      evidenceLimit: "Listing claim and activity signals are illustrative; confidence would be limited at this sample size."
    },
    {
      id: "growth-operators",
      adoptionPubkeys: 18,
      adoptionRepos: 0,
      probesTotal: 30,
      probesSuccessful: 30,
      metadataTended: "6 days ago",
      name: "Growth Operators",
      focusArea: "Building",
      summary: "Human-agent campaign experiments with public results and critiques.",
      about: "Growth Operators runs campaign experiments for community projects and publishes both the output and the evaluation process behind it.",
      tags: ["Campaigns", "Distribution", "Analytics"],
      rating: 4.5,
      ratings: 51,
      relayOpens: 207,
      activity: 88,
      activityLabel: "Very active",
      activityAsOf: "Example: 4 days ago",
      listedAt: "2026-01-16",
      score: 86,
      quality: 84,
      momentum: 89,
      verified: true,
      claimed: true,
      access: "invite",
      probedAgo: "3h ago",
      currentWork: "Testing transparent distribution playbooks for community-led launches.",
      whyRanked: "Recent example activity and relay-link opens keep momentum high.",
      evidenceLimit: "Relay opens measure intent, not confirmed membership."
    },
    {
      id: "story-lab",
      adoptionPubkeys: 9,
      adoptionRepos: 0,
      probesTotal: 30,
      probesSuccessful: 27,
      metadataTended: "3 weeks ago",
      name: "Onchain Story Lab",
      focusArea: "Design & creative",
      summary: "Writers and agents building participatory stories and digital artifacts.",
      about: "Onchain Story Lab brings writers, artists, and agents together to create serialized stories and participatory digital artifacts.",
      tags: ["Writing", "Art", "Story worlds"],
      rating: 4.6,
      ratings: 29,
      relayOpens: 188,
      activity: 76,
      activityLabel: "Active",
      activityAsOf: "Example: 8 days ago",
      listedAt: "2026-05-30",
      score: 80,
      quality: 85,
      momentum: 75,
      verified: true,
      claimed: true,
      access: "public",
      probedAgo: "16h ago",
      currentWork: "Producing a community-authored serial with reusable agent characters.",
      whyRanked: "The example shows encouraging activity, with confidence limited by a shorter track record.",
      evidenceLimit: "No private creative work or community conversations were inspected."
    },
    {
      id: "vibe-coders-nyc",
      adoptionPubkeys: 2,
      adoptionRepos: 0,
      probesTotal: 6,
      probesSuccessful: 5,
      metadataTended: null,
      name: "Vibe Coders NYC",
      focusArea: "Local & regional",
      summary: "New York builders shipping small projects and finding first users.",
      about: "A local group for builders shipping small products. Members pair on implementation, test each other's work, and help find first users.",
      tags: ["New York", "Vibe coding", "Launches"],
      rating: 4.4,
      ratings: 17,
      relayOpens: 96,
      activity: 71,
      activityLabel: "Active",
      activityAsOf: "Example: 12 days ago",
      listedAt: "2026-07-08",
      score: 74,
      quality: 77,
      momentum: 72,
      verified: false,
      claimed: false,
      access: "public",
      probedAgo: null,
      currentWork: "Organizing a small-project demo night for New York builders.",
      whyRanked: "Not ranked because the example relay identity check is still pending.",
      evidenceLimit: "Technical identity is pending, so the listing would be excluded from public rankings."
    }
  ];

  const viewRoot = document.querySelector("#view-root");
  const announcer = document.querySelector("#announcer");
  const filterDialog = document.querySelector("#filter-dialog");
  const previewDialog = document.querySelector("#preview-dialog");
  const joinDialog = document.querySelector("#join-dialog");
  const headerSearch = document.querySelector("#community-search");
  const FOCUS_AREAS = ["Building", "AI & agents", "Bitcoin & money", "Design & creative", "Research & knowledge", "Local & regional", "Team & private", "Uncategorized"];
  const exampleRanks = new Map(
    communities
      .filter((community) => community.verified)
      .sort((a, b) => b.score - a.score)
      .map((community, index) => [community.id, index + 1])
  );
  const allowedViews = new Set(["directory", "community", "method", "submit"]);
  const allowedSorts = new Set(["activity", "new"]);
  let searchTimer;
  let shouldFocusHeading = false;
  let lastRenderedView = null;
  let lastInspectedId = "";

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const stateFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const view = allowedViews.has(params.get("view")) ? params.get("view") : "directory";
    return {
      view,
      id: params.get("id") || "",
      directoryStatus: ["loading", "error"].includes(params.get("status")) ? params.get("status") : "ready",
      q: params.get("q") || "",
      access: ["public", "invite"].includes(params.get("access")) ? params.get("access") : "Any",
      focusArea: FOCUS_AREAS.includes(params.get("focus"))
        ? params.get("focus")
        : "Any",
      activityFilter: ["Very active", "Active"].includes(params.get("activity")) ? params.get("activity") : "Any",
      sort: allowedSorts.has(params.get("sort")) ? params.get("sort") : "activity"
    };
  };

  let state = stateFromUrl();

  const writeUrl = ({ push = false } = {}) => {
    const params = new URLSearchParams();
    if (state.view !== "directory") params.set("view", state.view);
    if (state.id) params.set("id", state.id);
    if (state.directoryStatus !== "ready") params.set("status", state.directoryStatus);
    if (state.q) params.set("q", state.q);
    if (state.access !== "Any") params.set("access", state.access);
    if (state.focusArea !== "Any") params.set("focus", state.focusArea);
    if (state.activityFilter !== "Any") params.set("activity", state.activityFilter);
    if (state.sort !== "activity") params.set("sort", state.sort);
    const nextUrl = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    window.history[push ? "pushState" : "replaceState"]({}, "", nextUrl);
  };

  const announce = (message) => {
    announcer.textContent = "";
    window.requestAnimationFrame(() => {
      announcer.textContent = message;
    });
  };

  const navigate = (view, id = "", { push = true, focus = true } = {}) => {
    state.view = view;
    state.id = view === "community" ? id : "";
    shouldFocusHeading = focus;
    writeUrl({ push });
    render();
  };

  const pageHref = (view, id = "") => {
    const next = new URLSearchParams(window.location.search);
    if (view === "directory") next.delete("view");
    else next.set("view", view);
    if (view === "community" && id) next.set("id", id);
    else next.delete("id");
    return `${window.location.pathname}${next.size ? `?${next}` : ""}`;
  };

  const setActiveNavigation = () => {
    document.querySelectorAll("[data-nav-view]").forEach((link) => {
      const target = link.dataset.navView;
      const active = target === state.view || (target === "directory" && state.view === "community");
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      link.setAttribute("href", pageHref(target));
    });
  };

  const rankLabel = (community) => community.verified ? `#${String(exampleRanks.get(community.id)).padStart(2, "0")}` : "—";

  // Mirrors src/ranking/activity.ts. Adoption is the popularity proxy: distinct
  // people naming this relay in their signed public relay list.
  const ACTIVITY_WINDOW_DAYS = 30;
  const ADOPTION_SATURATION = 250;
  const EVIDENCE_FLOOR = { adoptionPubkeys: 3, probesTotal: 5 };

  const activityScore = (community) => {
    const weighted = community.adoptionPubkeys + community.adoptionRepos * 0.5;
    const adoption = weighted <= 0
      ? 0
      : Math.min(100, (Math.log1p(weighted) / Math.log1p(ADOPTION_SATURATION)) * 100);
    const liveness = community.probesTotal <= 0
      ? 0
      : (community.probesSuccessful / community.probesTotal) * 100;
    const tending = community.metadataTended ? 60 : 0;
    return Math.round(adoption * 0.5 + liveness * 0.3 + tending * 0.2);
  };

  const hasEnoughEvidence = (community) =>
    community.adoptionPubkeys >= EVIDENCE_FLOOR.adoptionPubkeys &&
    community.probesTotal >= EVIDENCE_FLOOR.probesTotal;

  const activityLabel = (community) => {
    if (!hasEnoughEvidence(community)) return "Limited evidence";
    const score = activityScore(community);
    if (score >= 70) return "Very active";
    if (score >= 40) return "Active";
    return "Quiet";
  };

  const plural = (count, singular, pluralForm) =>
    `${count} ${count === 1 ? singular : pluralForm}`;

  // The recommendation copy is the ranking inputs rendered, so it cannot drift
  // from the score it explains.
  const recommendationReasons = (community) => {
    const reasons = [];
    if (community.adoptionPubkeys > 0) {
      reasons.push(`Named in ${plural(community.adoptionPubkeys, "person's", "people's")} public relay list`);
    }
    if (community.adoptionRepos > 0) {
      reasons.push(`Referenced in ${plural(community.adoptionRepos, "public code file", "public code files")}`);
    }
    if (community.probesTotal > 0) {
      const uptime = Math.round((community.probesSuccessful / community.probesTotal) * 100);
      reasons.push(`Reachable on ${uptime}% of checks over ${ACTIVITY_WINDOW_DAYS} days`);
    }
    if (community.metadataTended) {
      reasons.push(`Relay details updated ${community.metadataTended}`);
    }
    if (!reasons.length) {
      reasons.push("Not enough observations yet to explain a ranking");
    }
    return reasons;
  };

  const probeReceipt = (community) =>
    community.verified
      ? `Buzz relay verified · probed ${community.probedAgo} (example)`
      : "Relay check pending";

  const accessFlag = (community) => `
    <span class="access-flag${community.access === "invite" ? " is-invite" : ""}">${community.access === "invite" ? "Private" : "Public"}</span>
  `;

  const identityMarkup = (community) => `
    <div class="identity-line${community.verified ? "" : " pending"}">
      <svg class="identity-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="8"></circle>
        ${community.verified ? '<path d="m6.5 10 2.2 2.2 4.8-5"></path>' : '<path d="M10 6.2v4.6M10 14h.01"></path>'}
      </svg>
      <span>${community.verified ? "Buzz relay verified" : "Relay check pending"}</span>
    </div>
  `;

  const freshnessLabel = (community) =>
    community.activityAsOf
      .replace("Example: ", "")
      .replace(" days ago", "d ago")
      .replace(" day ago", "d ago");

  const communityIndexRow = (community, selectedId, index) => {
    const selected = community.id === selectedId;
    return `
      <li style="--stagger-i: ${Math.min(index, 8)}">
        <button
          class="community-index-row${selected ? " is-selected" : ""}"
          type="button"
          data-inspect-id="${community.id}"
          aria-pressed="${selected}"
        >
          <span class="index-community-cell">
            <img class="index-insignia" src="/assets/communities/${community.id}.png" alt="" width="48" height="48">
            <span class="index-community-copy">
              <span class="index-name-line">
                <strong>${escapeHtml(community.name)}</strong>
                ${accessFlag(community)}
              </span>
              <small>${escapeHtml(community.summary)}</small>
            </span>
          </span>
          <span class="index-focus-cell">${escapeHtml(community.focusArea)}</span>
          <span class="index-activity-cell${activityLabel(community) === "Very active" ? " is-very-active" : ""}${hasEnoughEvidence(community) ? "" : " is-unproven"}">
            <span class="activity-dot" aria-hidden="true"></span>
            ${escapeHtml(activityLabel(community))}
          </span>
          <span class="index-freshness-cell">${escapeHtml(freshnessLabel(community))}</span>
          <svg class="index-row-arrow" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 6 6 6-6 6"></path>
          </svg>
        </button>
      </li>
    `;
  };

  const communityInspector = (community, arriving = false) => `
    <article id="community-inspector" class="community-inspector${arriving ? " is-arriving" : ""}" aria-labelledby="inspector-title">
      <header class="inspector-header">
        <div class="inspector-heading">
          <img class="inspector-insignia" src="/assets/communities/${community.id}.png" alt="" width="72" height="72">
          <div>
            <h2 id="inspector-title" tabindex="-1">${escapeHtml(community.name)}</h2>
            <p>${escapeHtml(community.summary)}</p>
            <div class="inspector-status">
              <span class="activity-label${activityLabel(community) === "Very active" ? " is-very-active" : ""}${hasEnoughEvidence(community) ? "" : " is-unproven"}">
                <span class="activity-dot" aria-hidden="true"></span>
                ${escapeHtml(activityLabel(community))}
              </span>
              <span>Updated ${escapeHtml(freshnessLabel(community))}</span>
              ${accessFlag(community)}
              <span class="illustrative-label">Illustrative</span>
            </div>
          </div>
        </div>
        <button class="button button--primary inspector-join" type="button" data-open-join="${community.id}">
          Join community
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
        </button>
      </header>

      <dl class="inspector-metrics">
        <div>
          <dt>Activity · 30d</dt>
          <dd>${hasEnoughEvidence(community) ? activityScore(community) : "—"}<small>${hasEnoughEvidence(community) ? "Illustrative score" : "Not enough evidence yet"}</small></dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>${escapeHtml(freshnessLabel(community))}<small>Last illustrative update</small></dd>
        </div>
      </dl>

      <div class="inspector-focus">
        <span>Focus</span>
        <div class="inspector-tags">${community.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      </div>

      <div class="inspector-sections">
        ${community.claimed ? `
        <section>
          <h3>Current work</h3>
          <p>${escapeHtml(community.currentWork)}</p>
          <small>Shared by the community’s operator.</small>
        </section>` : ""}
        <section>
          <h3>Why it’s recommended</h3>
          <ul class="reason-list">
            ${recommendationReasons(community).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
          </ul>
          <small>These are the ranking inputs, not a written summary.</small>
        </section>
        <section>
          <h3>About</h3>
          <p>${escapeHtml(community.about)}</p>
          <small>From the relay’s own published details.</small>
        </section>
      </div>

      <footer class="inspector-footer">
        <a href="${pageHref("community", community.id)}" data-community-id="${community.id}">View full profile</a>
      </footer>
    </article>
  `;

  const filteredCommunities = () => {
    const query = state.q.trim().toLowerCase();
    const result = communities.filter((community) => {
      const matchesQuery = !query || [community.name, community.summary, community.focusArea, ...community.tags]
        .join(" ")
        .toLowerCase()
        .includes(query);
      const matchesAccess = state.access === "Any" || community.access === state.access;
      const matchesFocus = state.focusArea === "Any" || community.focusArea === state.focusArea;
      const matchesActivity = state.activityFilter === "Any" || activityLabel(community) === state.activityFilter;
      return matchesQuery && matchesAccess && matchesFocus && matchesActivity;
    });
    return result.sort((a, b) => {
      if (state.sort === "new") return new Date(b.listedAt) - new Date(a.listedAt);
      const evidenceGap = Number(hasEnoughEvidence(b)) - Number(hasEnoughEvidence(a));
      if (evidenceGap !== 0) return evidenceGap;
      return activityScore(b) - activityScore(a);
    });
  };

  const optionMarkup = (values, selected) =>
    values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");

  const activeFilterMarkup = () => {
    const filters = [];
    if (state.q) filters.push(`Search: “${escapeHtml(state.q)}”`);
    if (state.focusArea !== "Any") filters.push(escapeHtml(state.focusArea));
    if (state.activityFilter !== "Any") filters.push(`${escapeHtml(state.activityFilter)} · 30d`);
    if (!filters.length) return "";
    return `
      <div class="active-filters" aria-label="Active filters">
        ${filters.map((filter) => `<span class="filter-chip">${filter}</span>`).join("")}
        <button class="clear-link" type="button" data-clear-filters>Clear all</button>
      </div>
    `;
  };

  const renderDirectory = () => {
    if (headerSearch && headerSearch.value !== state.q) headerSearch.value = state.q;
    const results = filteredCommunities();
    const selectedCommunity = results.find((community) => community.id === state.id) || results[0] || null;
    if (selectedCommunity && selectedCommunity.id !== state.id) {
      state.id = selectedCommunity.id;
      writeUrl();
    }
    const entering = lastRenderedView !== "directory";
    const inspectorArriving = Boolean(selectedCommunity) && selectedCommunity.id !== lastInspectedId;
    lastInspectedId = selectedCommunity ? selectedCommunity.id : "";
    lastRenderedView = "directory";
    viewRoot.innerHTML = `
      <div class="workspace-shell">
        <header class="premise-band${entering ? " is-entering" : ""}">
          <div class="premise-copy">
            <h1 id="page-title" tabindex="-1">
              Find a Buzz community
              <em class="premise-mark">worth joining.
                <svg class="premise-underline" viewBox="0 0 220 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                  <path pathLength="1" d="M4 9 C 60 3.5, 150 2.5, 216 6.5"/>
                </svg>
              </em>
            </h1>
            <p>Every listing is checked at the relay itself.</p>
          </div>
          <svg class="premise-signal" viewBox="0 0 340 140" aria-hidden="true" focusable="false">
            <path class="route-line" d="M60 74 C 130 28, 214 28, 282 64"/>
            <path class="route-pulse" pathLength="100" d="M60 74 C 130 28, 214 28, 282 64"/>
            <circle class="signal-ring signal-ring--late" cx="60" cy="74" r="15"/>
            <circle class="signal-ring" cx="60" cy="74" r="15"/>
            <circle class="signal-origin" cx="60" cy="74" r="7"/>
            <circle class="signal-relay" cx="282" cy="64" r="15"/>
            <path class="signal-check" d="m276 64 4.5 4.5 8.5-9.5"/>
            <text class="signal-label" x="60" y="112" text-anchor="middle">BuzzRouter</text>
            <text class="signal-label" x="282" y="104" text-anchor="middle">verified</text>
            <text class="signal-label signal-label--route" x="172" y="18" text-anchor="middle">checked directly</text>
          </svg>
        </header>
        <section class="command-bar" aria-label="Filter and sort communities">
          <label class="command-filter">
            <span>Focus</span>
            <select id="focus-filter">${optionMarkup(["Any", ...FOCUS_AREAS], state.focusArea)}</select>
          </label>
          <label class="command-filter activity-command-filter">
            <span>Activity</span>
            <select id="activity-filter">${optionMarkup(["Any", "Very active", "Active"], state.activityFilter)}</select>
          </label>
          <label class="command-filter sort-command-filter">
            <span>Sort</span>
            <select id="sort-control">
              <option value="activity"${state.sort === "activity" ? " selected" : ""}>Most active</option>
              <option value="new"${state.sort === "new" ? " selected" : ""}>Newest listing</option>
            </select>
          </label>
          <button class="button button--secondary mobile-filter-button" type="button" data-open-filters>Filter & sort</button>
          <span class="result-count"><strong>${results.length}</strong> ${results.length === 1 ? "result" : "results"}</span>
        </section>

        <div class="category-rail" role="group" aria-label="Filter by access">
          ${[["Any", "All"], ["public", "Public"], ["invite", "Private"]].map(([value, label]) => `
            <button class="category-chip" type="button" data-access-chip="${value}" aria-pressed="${state.access === value}">${label}</button>
          `).join("")}
        </div>

        ${activeFilterMarkup()}

        <div class="workspace-grid">
          <section class="community-index" aria-labelledby="directory-results-title">
            <div class="community-index-header" aria-hidden="true">
              <span>Community</span>
              <span>Focus</span>
              <span>Activity</span>
              <span>Freshness</span>
              <span></span>
            </div>
            <h2 id="directory-results-title" class="visually-hidden">Community results</h2>
            ${state.directoryStatus === "loading" ? `
              <div class="directory-state" aria-busy="true">
                <strong>Loading preview listings</strong>
                <span class="loading-line"></span>
                <span class="loading-line loading-line--short"></span>
              </div>
            ` : state.directoryStatus === "error" ? `
              <div class="directory-state" role="alert">
                <h2>Preview listings could not be loaded</h2>
                <p>Try again without changing your filters or comparison.</p>
                <button class="button button--primary" type="button" data-retry-directory>Try again</button>
              </div>
            ` : results.length ? `
              <ul class="community-index-list${entering ? " is-entering" : ""}">
                ${results.map((community, index) => communityIndexRow(community, selectedCommunity.id, index)).join("")}
              </ul>
            ` : `
              <div class="empty-state">
                <h2>No communities on this route</h2>
                <p>Nothing matches the current filters. Clear them to see every illustrative listing.</p>
                <button class="button button--primary" type="button" data-clear-filters>Clear filters</button>
              </div>
            `}
            <footer class="community-index-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
              <span><kbd>Enter</kbd> Inspect</span>
              <button class="clear-link" type="button" data-open-preview>All data is illustrative</button>
            </footer>
          </section>

          ${selectedCommunity && state.directoryStatus === "ready"
            ? communityInspector(selectedCommunity, inspectorArriving)
            : `<aside class="community-inspector inspector-placeholder" aria-label="Community inspector">
                <p>${state.directoryStatus === "error" ? "The inspector will return when listings load." : "Select a community to inspect its signal here."}</p>
              </aside>`}
        </div>

        <section class="workspace-actions" aria-label="Directory actions">
          <p>BuzzRouter routes you to the community; joining happens in its own Buzz space.</p>
        </section>
      </div>
    `;
    if (state.directoryStatus === "loading") announce("Loading illustrative community listings.");
    else if (state.directoryStatus === "error") announce("Preview listings could not be loaded.");
    else announce(`${results.length} ${results.length === 1 ? "community" : "communities"} shown.`);
  };

  const renderCommunity = () => {
    const community = communities.find((item) => item.id === state.id);
    if (!community) {
      state.view = "directory";
      state.id = "";
      writeUrl();
      renderDirectory();
      announce("That community is not available. Returned to the directory.");
      return;
    }
    viewRoot.innerHTML = `
      <div class="page-shell content-page">
        <a class="back-link" href="${pageHref("directory")}" data-nav-view="directory">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h11"></path></svg>
          Back to directory
        </a>
        <header class="content-page__header profile-header">
          <div>
            <h1 id="page-title" tabindex="-1">${escapeHtml(community.name)}</h1>
            <p class="lede">${escapeHtml(community.summary)}</p>
            <div class="profile-meta">
              <span class="status-label${community.verified ? "" : " pending"}">${probeReceipt(community)}</span>
              <span class="status-label${community.claimed ? "" : " pending"}">${community.claimed ? "Operator claimed" : "Unclaimed preview"}</span>
              <span class="status-label neutral">${community.access === "invite" ? "Private" : "Public"}</span>
            </div>
          </div>
          <div class="profile-actions">
            <button class="button button--primary" type="button" data-open-join="${community.id}">Join ${escapeHtml(community.name)}</button>
          </div>
        </header>
        <div class="content-page__body">
          <section class="section-card">
            <h2>What this community does</h2>
            <p>${escapeHtml(community.about)}</p>
            <div class="tag-list">${community.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
          </section>
          <div class="profile-grid">
            <section class="section-card">
              <h2>What members are working on</h2>
              <p>${escapeHtml(community.currentWork)}</p>
              <p><small>Illustrative, operator-reported information.</small></p>
            </section>
            <section class="section-card">
              <h2>Why it appears at ${community.verified ? rankLabel(community) : "not ranked"}</h2>
              <p>${escapeHtml(community.whyRanked)}</p>
              <p><small>${escapeHtml(community.evidenceLimit)}</small></p>
            </section>
          </div>
          <section class="section-card">
            <h2>Evidence record</h2>
            <p>Signals are separated so popularity cannot stand in for quality.</p>
            <div class="evidence-grid">
              <div class="evidence-item"><strong>Technical identity</strong><p>${probeReceipt(community)}. This is a software identity check, not a quality endorsement.</p></div>
              <div class="evidence-item"><strong>Activity</strong><p>${escapeHtml(activityLabel(community))} · from ${community.adoptionPubkeys} public relay lists and ${community.probesSuccessful}/${community.probesTotal} successful checks.</p></div>
              <div class="evidence-item"><strong>Join intent</strong><p>${community.relayOpens} illustrative relay-link opens in 30 days. Opens do not confirm membership.</p></div>
              <div class="evidence-item"><strong>Listing basis</strong><p>${community.claimed ? "Illustrative operator claim" : "Unclaimed example listing"} · profile details are example data.</p></div>
              <div class="evidence-item"><strong>Privacy boundary</strong><p>BuzzRouter does not read messages, channels, members, or private activity.</p></div>
            </div>
          </section>
        </div>
      </div>
    `;
  };

  const renderMethod = () => {
    viewRoot.innerHTML = `
      <div class="page-shell content-page">
        <header class="content-page__header">
          <h1 id="page-title" tabindex="-1">Ranking should explain itself.</h1>
          <p class="lede">The proposed method rewards real, recent activity, discounts thin evidence, and treats popularity as only one input.</p>
        </header>
        <div class="content-page__body">
          <section class="section-card">
            <h2>Example weighting</h2>
            <p>This weighting is a proposal; public rankings are not live yet.</p>
            <div class="method-grid">
              <div class="method-item"><strong>55% · Current activity</strong><p>Fresh, attributable activity signals observed directly at the relay. Operator-reported information is labeled and private relay content is never read.</p></div>
              <div class="method-item"><strong>25% · Join intent</strong><p>Unique, bot-filtered opens of native relay links. This measures interest, not confirmed membership.</p></div>
              <div class="method-item"><strong>20% · Listing quality</strong><p>Technical relay identity, profile completeness, freshness, and listing provenance.</p></div>
            </div>
          </section>
          <section class="section-card">
            <h2>Technical verification is not endorsement</h2>
            <p>“Buzz relay verified” means public metadata and connection behavior match the Buzz software. It does not mean BuzzRouter recommends the community or has reviewed its private activity.</p>
          </section>
          <section class="section-card">
            <h2>Cold-start communities</h2>
            <p>New listings should remain discoverable without receiving false confidence. Until evidence is sufficient, the interface uses “Limited evidence” or “Not ranked” instead of zeros.</p>
          </section>
        </div>
      </div>
    `;
  };

  const renderSubmit = () => {
    viewRoot.innerHTML = `
      <div class="page-shell content-page">
        <header class="content-page__header">
          <h1 id="page-title" tabindex="-1">List your <em class="premise-mark">community.
            <svg class="premise-underline" viewBox="0 0 220 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <path pathLength="1" d="M4 9 C 60 3.5, 150 2.5, 216 6.5"/>
            </svg>
          </em></h1>
          <p class="lede">Listing starts with a relay check — BuzzRouter contacts your relay directly before anything is published. Review does not guarantee publication or ranking.</p>
        </header>
        <div class="content-page__body">
          <section class="section-card">
            <form id="listing-form" class="listing-form">
              <div class="form-grid">
                <label class="field">
                  <span>Community name</span>
                  <input name="name" type="text" required maxlength="80" autocomplete="organization">
                </label>
                <label class="field">
                  <span>Public Buzz relay URL</span>
                  <input name="relay" type="url" required placeholder="wss://community.example">
                  <small>BuzzRouter checks only public relay metadata and connection behavior.</small>
                </label>
                <label class="field">
                  <span>Contact email</span>
                  <input name="email" type="email" required autocomplete="email">
                  <small>Used for review questions; not shown publicly.</small>
                </label>
                <label class="field">
                  <span>Focus</span>
                  <select name="focus" required>
                    <option value="">Choose a focus</option>
                    ${FOCUS_AREAS.filter((focus) => focus !== "Uncategorized").map((focus) => `<option>${escapeHtml(focus)}</option>`).join("")}
                  </select>
                  <small>Pick the closest fit; BuzzRouter reviews it before listing.</small>
                </label>
              </div>
              <label class="field">
                <span>What is this community for?</span>
                <textarea name="purpose" required maxlength="500"></textarea>
                <small>Describe the audience, purpose, and current work in plain language.</small>
              </label>
              <div class="form-actions">
                <button class="button button--primary" type="submit">Send preview submission</button>
                <p id="form-status" class="form-status" role="status" aria-live="polite"></p>
              </div>
            </form>
          </section>
        </div>
      </div>
    `;
  };

  const syncFilterDialog = () => {
    const focus = document.querySelector("#mobile-focus");
    const activity = document.querySelector("#mobile-activity");
    const sort = document.querySelector("#mobile-sort");
    if (focus) focus.value = state.focusArea;
    if (activity) activity.value = state.activityFilter;
    if (sort) sort.value = state.sort;
  };

  const render = () => {
    setActiveNavigation();
    if (state.view === "community") renderCommunity();
    else if (state.view === "method") renderMethod();
    else if (state.view === "submit") renderSubmit();
    else renderDirectory();
    lastRenderedView = state.view;
    syncFilterDialog();
    if (shouldFocusHeading) {
      const heading = document.querySelector("#page-title");
      if (heading) heading.focus({ preventScroll: false });
      announce(`${heading?.textContent || "Page"} loaded.`);
      shouldFocusHeading = false;
    }
  };

  const updateFilters = ({ access, focusArea, activityFilter, sort, q } = {}) => {
    if (access !== undefined) state.access = access;
    if (focusArea !== undefined) state.focusArea = focusArea;
    if (activityFilter !== undefined) state.activityFilter = activityFilter;
    if (sort !== undefined) state.sort = sort;
    if (q !== undefined) state.q = q;
    state.directoryStatus = "ready";
    state.view = "directory";
    writeUrl();
    renderDirectory();
    syncFilterDialog();
  };

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav-view]");
    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.navView);
      return;
    }
    const communityLink = event.target.closest("[data-community-id]");
    if (communityLink) {
      event.preventDefault();
      navigate("community", communityLink.dataset.communityId);
      return;
    }
    const inspectorChoice = event.target.closest("[data-inspect-id]");
    if (inspectorChoice) {
      state.view = "directory";
      state.id = inspectorChoice.dataset.inspectId;
      writeUrl({ push: true });
      renderDirectory();
      syncFilterDialog();
      const selected = communities.find((community) => community.id === state.id);
      announce(`${selected?.name || "Community"} selected.`);
      if (window.matchMedia("(max-width: 860px)").matches) {
        const heading = document.querySelector("#inspector-title");
        heading?.focus({ preventScroll: true });
        document.querySelector("#community-inspector")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    const accessChip = event.target.closest("[data-access-chip]");
    if (accessChip) {
      updateFilters({ access: accessChip.dataset.accessChip });
      return;
    }
    if (event.target.closest("[data-clear-filters]")) {
      updateFilters({ access: "Any", focusArea: "Any", activityFilter: "Any", sort: "activity", q: "" });
      if (filterDialog.open) filterDialog.close();
      announce("All directory filters cleared.");
      return;
    }
    if (event.target.closest("[data-retry-directory]")) {
      state.directoryStatus = "ready";
      writeUrl();
      render();
      announce("Preview listings loaded.");
      return;
    }
    if (event.target.closest("[data-open-filters]")) {
      syncFilterDialog();
      filterDialog.showModal();
      return;
    }
    if (event.target.closest("[data-open-preview]")) {
      previewDialog.showModal();
      return;
    }
    if (event.target.closest("[data-close-preview]")) {
      previewDialog.close();
      return;
    }
    const joinTrigger = event.target.closest("[data-open-join]");
    if (joinTrigger) {
      const community = communities.find((item) => item.id === joinTrigger.dataset.openJoin);
      const copy = document.querySelector("#join-community-copy");
      if (copy && community) {
        copy.textContent = `${community.name} is an illustrative listing without a public relay URL. No external site will be opened.`;
      }
      joinDialog.showModal();
      return;
    }
    if (event.target.closest("[data-close-join]")) {
      joinDialog.close();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "community-search") {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => updateFilters({ q: event.target.value }), 180);
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "focus-filter") updateFilters({ focusArea: event.target.value });
    if (event.target.id === "activity-filter") updateFilters({ activityFilter: event.target.value });
    if (event.target.id === "sort-control") updateFilters({ sort: event.target.value });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      const search = document.querySelector("#community-search");
      if (search) {
        event.preventDefault();
        search.focus();
        search.select();
      }
      return;
    }
    const row = event.target.closest("[data-inspect-id]");
    if (!row || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const rows = [...document.querySelectorAll("[data-inspect-id]")];
    const current = rows.indexOf(row);
    const next = event.key === "ArrowDown"
      ? Math.min(rows.length - 1, current + 1)
      : Math.max(0, current - 1);
    event.preventDefault();
    rows[next]?.focus();
  });

  filterDialog.addEventListener("close", () => {
    if (filterDialog.returnValue === "apply") {
      updateFilters({
        focusArea: document.querySelector("#mobile-focus").value,
        activityFilter: document.querySelector("#mobile-activity").value,
        sort: document.querySelector("#mobile-sort").value
      });
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "listing-form") return;
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('button[type="submit"]');
    const status = form.querySelector("#form-status");
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    status.textContent = "Preview submission recorded locally. No listing was sent.";
    form.removeAttribute("aria-busy");
    announce("Preview submission recorded locally. No listing was sent.");
  });

  window.addEventListener("popstate", () => {
    state = stateFromUrl();
    shouldFocusHeading = true;
    render();
  });

  render();
})();
