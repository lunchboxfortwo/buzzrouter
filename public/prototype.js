(() => {
  "use strict";

  const communities = [
    {
      id: "agent-commons",
      name: "Agent Commons",
      category: "Development",
      focusArea: "Agent tools",
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
      currentWork: "Maintaining an open evaluation dataset for interoperable agents.",
      whyRanked: "Ranks highly because the example combines strong member ratings, a substantial evidence count, and recent listing activity.",
      evidenceLimit: "Activity is illustrative and operator-reported; no private relay content was inspected."
    },
    {
      id: "prompt-forge",
      name: "Prompt Forge",
      category: "Development",
      focusArea: "Agent tools",
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
      currentWork: "Publishing a shared prompt regression suite and weekly critique notes.",
      whyRanked: "The example score reflects consistent ratings, fresh operator updates, and sustained relay-link interest.",
      evidenceLimit: "Ratings and activity are illustrative; the public ranking pipeline is not connected."
    },
    {
      id: "open-research",
      name: "Open Research Guild",
      category: "Research",
      focusArea: "Open knowledge",
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
      currentWork: "Coordinating an open replication sprint across three public datasets.",
      whyRanked: "A high example rating is tempered by a smaller evidence sample and lower recent momentum.",
      evidenceLimit: "Listing claim and activity signals are illustrative; confidence would be limited at this sample size."
    },
    {
      id: "growth-operators",
      name: "Growth Operators",
      category: "Growth",
      focusArea: "Community growth",
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
      currentWork: "Testing transparent distribution playbooks for community-led launches.",
      whyRanked: "Recent example activity and relay-link opens raise momentum while ratings remain well supported.",
      evidenceLimit: "Relay opens measure intent, not confirmed membership."
    },
    {
      id: "story-lab",
      name: "Onchain Story Lab",
      category: "Creative",
      focusArea: "Creative production",
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
      currentWork: "Producing a community-authored serial with reusable agent characters.",
      whyRanked: "The example has encouraging quality signals, with confidence limited by a smaller rating count.",
      evidenceLimit: "No private creative work or community conversations were inspected."
    },
    {
      id: "vibe-coders-nyc",
      name: "Vibe Coders NYC",
      category: "Local",
      focusArea: "Local building",
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
      currentWork: "Organizing a small-project demo night for New York builders.",
      whyRanked: "Not ranked because the example relay identity check is still pending.",
      evidenceLimit: "Technical identity is pending, so the listing would be excluded from public rankings."
    }
  ];

  const viewRoot = document.querySelector("#view-root");
  const tray = document.querySelector("#compare-tray");
  const announcer = document.querySelector("#announcer");
  const filterDialog = document.querySelector("#filter-dialog");
  const previewDialog = document.querySelector("#preview-dialog");
  const joinDialog = document.querySelector("#join-dialog");
  const headerSearch = document.querySelector("#community-search");
  const categories = [...new Set(communities.map((item) => item.category))].sort();
  const exampleRanks = new Map(
    communities
      .filter((community) => community.verified)
      .sort((a, b) => b.score - a.score)
      .map((community, index) => [community.id, index + 1])
  );
  const allowedViews = new Set(["directory", "community", "compare", "method", "submit"]);
  const allowedSorts = new Set(["rank", "quality", "activity", "new"]);
  let searchTimer;
  let shouldFocusHeading = false;

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
    const compare = [...new Set((params.get("compare") || "").split(",").filter(Boolean))]
      .filter((id) => communities.some((community) => community.id === id))
      .slice(0, 3);
    return {
      view,
      id: params.get("id") || "",
      directoryStatus: ["loading", "error"].includes(params.get("status")) ? params.get("status") : "ready",
      q: params.get("q") || "",
      category: categories.includes(params.get("category")) ? params.get("category") : "All",
      focusArea: ["Agent tools", "Open knowledge", "Community growth", "Creative production", "Local building"].includes(params.get("focus"))
        ? params.get("focus")
        : "Any",
      verification: ["Verified", "Pending"].includes(params.get("verification"))
        ? params.get("verification")
        : params.get("verified") === "1" ? "Verified" : "Any",
      activityFilter: ["Very active", "Active"].includes(params.get("activity")) ? params.get("activity") : "Any",
      sort: allowedSorts.has(params.get("sort")) ? params.get("sort") : "rank",
      compare
    };
  };

  let state = stateFromUrl();

  const writeUrl = ({ push = false } = {}) => {
    const params = new URLSearchParams();
    if (state.view !== "directory") params.set("view", state.view);
    if (state.id) params.set("id", state.id);
    if (state.directoryStatus !== "ready") params.set("status", state.directoryStatus);
    if (state.q) params.set("q", state.q);
    if (state.category !== "All") params.set("category", state.category);
    if (state.focusArea !== "Any") params.set("focus", state.focusArea);
    if (state.verification !== "Any") params.set("verification", state.verification);
    if (state.activityFilter !== "Any") params.set("activity", state.activityFilter);
    if (state.sort !== "rank") params.set("sort", state.sort);
    if (state.compare.length) params.set("compare", state.compare.join(","));
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
      const active = target === state.view || (target === "directory" && ["community", "compare"].includes(state.view));
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      link.setAttribute("href", pageHref(target));
    });
  };

  const rankLabel = (community) => community.verified ? `#${String(exampleRanks.get(community.id)).padStart(2, "0")}` : "—";

  const confidenceLabel = (community) => {
    if (!community.verified) return "Pending check";
    if (community.ratings >= 50) return "High confidence";
    return "Limited evidence";
  };

  const identityMarkup = (community) => `
    <div class="identity-line${community.verified ? "" : " pending"}">
      <svg class="identity-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="8"></circle>
        ${community.verified ? '<path d="m6.5 10 2.2 2.2 4.8-5"></path>' : '<path d="M10 6.2v4.6M10 14h.01"></path>'}
      </svg>
      <span>${community.verified ? "Buzz relay verified" : "Relay check pending"}</span>
    </div>
  `;

  const compareButton = (community, profile = false) => {
    const selected = state.compare.includes(community.id);
    const full = state.compare.length >= 3 && !selected;
    return `
      <button
        class="${profile ? "button button--secondary" : "select-control"}"
        type="button"
        data-compare-id="${community.id}"
        aria-pressed="${selected}"
        aria-label="${selected ? "Remove" : "Add"} ${escapeHtml(community.name)} ${selected ? "from" : "to"} comparison"
        ${full ? 'disabled aria-describedby="compare-limit-note"' : ""}
      >
        ${profile ? (selected ? "Selected" : "Compare") : '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="select-add" d="M12 7v10M7 12h10"></path><path class="select-check" d="m5 12 4 4 10-10"></path></svg>'}
      </button>
    `;
  };

  const freshnessLabel = (community) =>
    community.activityAsOf
      .replace("Example: ", "")
      .replace(" days ago", "d ago")
      .replace(" day ago", "d ago");

  const communityIndexRow = (community, selectedId) => {
    const selected = community.id === selectedId;
    return `
      <li>
        <button
          class="community-index-row${selected ? " is-selected" : ""}"
          type="button"
          data-inspect-id="${community.id}"
          aria-pressed="${selected}"
        >
          <span class="index-community-cell">
            <img class="index-insignia" src="/assets/communities/${community.id}.png" alt="" width="48" height="48">
            <span class="index-community-copy">
              <strong>${escapeHtml(community.name)}</strong>
              <small>${escapeHtml(community.summary)}</small>
            </span>
          </span>
          <span class="index-focus-cell">${escapeHtml(community.focusArea)}</span>
          <span class="index-activity-cell${community.activityLabel === "Very active" ? " is-very-active" : ""}">
            <span class="activity-dot" aria-hidden="true"></span>
            ${escapeHtml(community.activityLabel)}
          </span>
          <span class="index-freshness-cell">${escapeHtml(freshnessLabel(community))}</span>
          <span class="index-rating-cell">
            <strong>${community.rating.toFixed(1)}</strong>
            <small>${community.ratings} ratings</small>
          </span>
          <svg class="index-row-arrow" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 6 6 6-6 6"></path>
          </svg>
        </button>
      </li>
    `;
  };

  const communityInspector = (community) => `
    <article id="community-inspector" class="community-inspector" aria-labelledby="inspector-title">
      <header class="inspector-header">
        <div class="inspector-heading">
          <img class="inspector-insignia" src="/assets/communities/${community.id}.png" alt="" width="72" height="72">
          <div>
            <h2 id="inspector-title" tabindex="-1">${escapeHtml(community.name)}</h2>
            <p>${escapeHtml(community.summary)}</p>
            <div class="inspector-status">
              <span class="activity-label${community.activityLabel === "Very active" ? " is-very-active" : ""}">
                <span class="activity-dot" aria-hidden="true"></span>
                ${escapeHtml(community.activityLabel)}
              </span>
              <span>Updated ${escapeHtml(freshnessLabel(community))}</span>
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
          <dd>${community.activity}<small>Illustrative score</small></dd>
        </div>
        <div>
          <dt>Rating</dt>
          <dd>${community.rating.toFixed(1)}<small>${community.ratings} illustrative ratings</small></dd>
        </div>
      </dl>

      <div class="inspector-focus">
        <span>Focus</span>
        <div class="inspector-tags">${community.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      </div>

      <div class="inspector-sections">
        <section>
          <h3>Current work</h3>
          <p>${escapeHtml(community.currentWork)}</p>
          <small>Illustrative, operator-reported information.</small>
        </section>
        <section class="inspector-evidence">
          <h3>Evidence and limitations</h3>
          <p>${escapeHtml(community.evidenceLimit)}</p>
          <p>${community.verified ? "Buzz relay verified" : "Relay identity check pending"}. Technical verification is not an endorsement.</p>
        </section>
        <section>
          <h3>Why it’s recommended</h3>
          <p>${escapeHtml(community.whyRanked)}</p>
          <small>${confidenceLabel(community)}.</small>
        </section>
        <section>
          <h3>About</h3>
          <p>${escapeHtml(community.about)}</p>
        </section>
      </div>

      <section class="inspector-facts">
        <h3>Activity facts</h3>
        <dl>
          <div><dt>Freshness</dt><dd>${escapeHtml(community.activityAsOf)}</dd></div>
          <div><dt>Relay-link opens</dt><dd>${community.relayOpens} illustrative opens · intent, not membership</dd></div>
          <div><dt>Technical identity</dt><dd>${community.verified ? "Buzz relay verified" : "Relay check pending"}</dd></div>
          <div><dt>Listing basis</dt><dd>${community.claimed ? "Illustrative operator claim" : "Unclaimed preview fixture"}</dd></div>
        </dl>
      </section>

      <footer class="inspector-footer">
        <a href="${pageHref("community", community.id)}" data-community-id="${community.id}">Open full evidence profile</a>
        ${compareButton(community, true)}
      </footer>
    </article>
  `;

  const filteredCommunities = () => {
    const query = state.q.trim().toLowerCase();
    const result = communities.filter((community) => {
      const matchesQuery = !query || [community.name, community.summary, community.category, ...community.tags]
        .join(" ")
        .toLowerCase()
        .includes(query);
      const matchesCategory = state.category === "All" || community.category === state.category;
      const matchesFocus = state.focusArea === "Any" || community.focusArea === state.focusArea;
      const matchesVerification =
        state.verification === "Any" ||
        (state.verification === "Verified" && community.verified) ||
        (state.verification === "Pending" && !community.verified);
      const matchesActivity = state.activityFilter === "Any" || community.activityLabel === state.activityFilter;
      return matchesQuery && matchesCategory && matchesFocus && matchesVerification && matchesActivity;
    });
    return result.sort((a, b) => {
      if (state.sort === "quality") return b.rating - a.rating || b.ratings - a.ratings;
      if (state.sort === "activity") return b.activity - a.activity;
      if (state.sort === "new") return new Date(b.listedAt) - new Date(a.listedAt);
      return b.score - a.score;
    });
  };

  const optionMarkup = (values, selected) =>
    values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");

  const activeFilterMarkup = () => {
    const filters = [];
    if (state.q) filters.push(`Search: “${escapeHtml(state.q)}”`);
    if (state.category !== "All") filters.push(escapeHtml(state.category));
    if (state.focusArea !== "Any") filters.push(escapeHtml(state.focusArea));
    if (state.verification !== "Any") filters.push(state.verification === "Verified" ? "Buzz relay verified" : "Relay check pending");
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
    viewRoot.innerHTML = `
      <div class="workspace-shell">
        <h1 id="page-title" class="visually-hidden" tabindex="-1">Discover Buzz communities</h1>
        <section class="command-bar" aria-label="Filter and sort communities">
          <label class="command-filter">
            <span>Category</span>
            <select id="category-filter">${optionMarkup(["All", ...categories], state.category)}</select>
          </label>
          <label class="command-filter">
            <span>Focus</span>
            <select id="focus-filter">${optionMarkup(["Any", "Agent tools", "Open knowledge", "Community growth", "Creative production", "Local building"], state.focusArea)}</select>
          </label>
          <label class="command-filter activity-command-filter">
            <span>Activity</span>
            <select id="activity-filter">${optionMarkup(["Any", "Very active", "Active"], state.activityFilter)}</select>
          </label>
          <label class="command-filter sort-command-filter">
            <span>Sort</span>
            <select id="sort-control">
              <option value="rank"${state.sort === "rank" ? " selected" : ""}>Example rank</option>
              <option value="quality"${state.sort === "quality" ? " selected" : ""}>Highest rated</option>
              <option value="activity"${state.sort === "activity" ? " selected" : ""}>Most active</option>
              <option value="new"${state.sort === "new" ? " selected" : ""}>Newest listing</option>
            </select>
          </label>
          <button class="button button--secondary mobile-filter-button" type="button" data-open-filters>Filter & sort</button>
          <span class="result-count"><strong>${results.length}</strong> ${results.length === 1 ? "result" : "results"}</span>
        </section>

        ${activeFilterMarkup()}
        <p id="compare-limit-note" class="visually-hidden">Remove a selected community before adding another.</p>

        <div class="workspace-grid">
          <section class="community-index" aria-labelledby="directory-results-title">
            <div class="community-index-header" aria-hidden="true">
              <span>Community</span>
              <span>Focus</span>
              <span>Activity</span>
              <span>Freshness</span>
              <span>Rating</span>
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
              <ul class="community-index-list">
                ${results.map((community) => communityIndexRow(community, selectedCommunity.id)).join("")}
              </ul>
            ` : `
              <div class="empty-state">
                <h2>No communities match</h2>
                <p>Your comparison selection is unchanged. Clear the filters to see every illustrative listing.</p>
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
            ? communityInspector(selectedCommunity)
            : `<aside class="community-inspector inspector-placeholder" aria-label="Community inspector">
                <p>${state.directoryStatus === "error" ? "The inspector will return when listings load." : "Choose a community to inspect it here."}</p>
              </aside>`}
        </div>

        <section class="workspace-actions" aria-label="Directory actions">
          <p>Curated discovery with activity and freshness kept separate from quality.</p>
          <div>
            <a href="${pageHref("method")}" data-nav-view="method">How recommendations work</a>
            <button class="button button--secondary" type="button" data-open-compare ${state.compare.length < 2 ? "disabled" : ""}>
              Compare selected (${state.compare.length})
            </button>
          </div>
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
              <span class="status-label${community.verified ? "" : " pending"}">${community.verified ? "Buzz relay verified" : "Relay check pending"}</span>
              <span class="status-label${community.claimed ? "" : " pending"}">${community.claimed ? "Operator claimed" : "Unclaimed preview"}</span>
            </div>
          </div>
          <div class="profile-actions">
            ${compareButton(community, true)}
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
              <div class="evidence-item"><strong>Technical identity</strong><p>${community.verified ? "Buzz relay verified" : "Relay check pending"}. This is a software identity check, not a quality endorsement.</p></div>
              <div class="evidence-item"><strong>Member reputation</strong><p>${community.rating.toFixed(1)} from ${community.ratings} illustrative ratings · ${confidenceLabel(community)}.</p></div>
              <div class="evidence-item"><strong>Activity</strong><p>${escapeHtml(community.activityLabel)} · operator reported · ${escapeHtml(community.activityAsOf)}.</p></div>
              <div class="evidence-item"><strong>Join intent</strong><p>${community.relayOpens} illustrative relay-link opens in 30 days. Opens do not confirm membership.</p></div>
              <div class="evidence-item"><strong>Listing basis</strong><p>${community.claimed ? "Illustrative operator claim" : "Unclaimed preview fixture"} · profile source is sample metadata.</p></div>
              <div class="evidence-item"><strong>Privacy boundary</strong><p>BuzzRouter does not read messages, channels, members, or private activity.</p></div>
            </div>
          </section>
        </div>
      </div>
    `;
  };

  const comparisonRows = [
    ["Purpose", (item) => item.summary],
    ["Category", (item) => item.category],
    ["Skills and interests", (item) => item.tags.join(", ")],
    ["Current work", (item) => item.currentWork],
    ["Member rating", (item) => `${item.rating.toFixed(1)} / 5 · ${item.ratings} example ratings`],
    ["Ranking confidence", (item) => confidenceLabel(item)],
    ["Quality contribution", (item) => `${item.quality} / 100 example score`],
    ["Activity · 30 days", (item) => `${item.activityLabel} · operator reported`],
    ["Relay-link opens", (item) => `${item.relayOpens} · measures intent, not membership`],
    ["Momentum contribution", (item) => `${item.momentum} / 100 example score`],
    ["Technical identity", (item) => item.verified ? "Buzz relay verified" : "Relay check pending"],
    ["Listing claim", (item) => item.claimed ? "Illustrative operator claim" : "Unclaimed preview"],
    ["Why it ranks here", (item) => item.whyRanked],
    ["Evidence limitation", (item) => item.evidenceLimit]
  ];

  const renderComparison = () => {
    const selected = state.compare.map((id) => communities.find((item) => item.id === id)).filter(Boolean);
    if (selected.length < 2) {
      state.view = "directory";
      writeUrl();
      renderDirectory();
      announce(selected.length === 1 ? "Choose one more community to compare." : "Choose two or three communities to compare.");
      return;
    }
    viewRoot.innerHTML = `
      <div class="page-shell content-page">
        <a class="back-link" href="${pageHref("directory")}" data-nav-view="directory">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h11"></path></svg>
          Edit selection in directory
        </a>
        <header class="content-page__header">
          <h1 id="page-title" tabindex="-1">Compare your shortlist.</h1>
          <p class="lede">${selected.length} communities selected. Signals stay separate so popularity cannot stand in for quality. Every value on this screen is illustrative.</p>
        </header>
        <div class="content-page__body">
          <section aria-labelledby="comparison-title">
            <h2 id="comparison-title" class="visually-hidden">Community evidence comparison</h2>
            <p class="scroll-hint">Swipe or scroll to compare all selected communities.</p>
            <div class="comparison-scroll" tabindex="0" role="region" aria-label="Scrollable comparison of selected communities">
              <table class="comparison-table">
                <thead>
                  <tr>
                    <th scope="col">Signal</th>
                    ${selected.map((item) => `<th scope="col"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)}</small></th>`).join("")}
                  </tr>
                </thead>
                <tbody>
                  ${comparisonRows.map(([label, getValue]) => `
                    <tr>
                      <th scope="row">${escapeHtml(label)}</th>
                      ${selected.map((item) => `<td>${escapeHtml(getValue(item))}</td>`).join("")}
                    </tr>
                  `).join("")}
                  <tr>
                    <th scope="row">Actions</th>
                    ${selected.map((item) => `
                      <td>
                        <a class="button button--secondary" href="${pageHref("community", item.id)}" data-community-id="${item.id}">View profile</a>
                        <button class="button button--quiet" type="button" data-remove-compare="${item.id}">Remove</button>
                      </td>
                    `).join("")}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section class="section-card">
            <h2>What these signals do—and do not—mean</h2>
            <p>Relay verification checks software identity and public connection behavior. It is not an endorsement. Relay-link opens measure interest, not confirmed membership. Activity is operator reported in this preview.</p>
            <a href="${pageHref("method")}" data-nav-view="method">Read the proposed ranking method</a>
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
          <p class="lede">Proposed method v1 separates quality from momentum, discounts thin evidence, and treats popularity as only one input.</p>
        </header>
        <div class="content-page__body">
          <section class="section-card">
            <h2>Example weighting</h2>
            <p>This method is proposed, not a live ranking pipeline.</p>
            <div class="method-grid">
              <div class="method-item"><strong>45% · Member quality</strong><p>Bayesian-adjusted ratings from verified identities. A few perfect ratings should not outrank a well-supported strong rating.</p></div>
              <div class="method-item"><strong>25% · Current activity</strong><p>Fresh, attributable activity signals. Operator-reported information is labeled and private relay content is never read.</p></div>
              <div class="method-item"><strong>20% · Join intent</strong><p>Unique, bot-filtered opens of native relay links. This measures interest, not confirmed membership.</p></div>
              <div class="method-item"><strong>10% · Listing quality</strong><p>Technical relay identity, profile completeness, freshness, and listing provenance.</p></div>
            </div>
          </section>
          <section class="section-card">
            <h2>Technical verification is not endorsement</h2>
            <p>“Buzz relay verified” means public metadata and connection behavior match the Buzz software. It does not mean BuzzRouter recommends the community or has reviewed its private activity.</p>
          </section>
          <section class="section-card">
            <h2>Cold-start communities</h2>
            <p>New listings should remain discoverable without receiving false confidence. Until evidence is sufficient, the interface uses “Not yet rated,” “Limited evidence,” or “Not ranked” instead of zeros.</p>
          </section>
        </div>
      </div>
    `;
  };

  const renderSubmit = () => {
    viewRoot.innerHTML = `
      <div class="page-shell content-page">
        <header class="content-page__header">
          <h1 id="page-title" tabindex="-1">Submit a community for review.</h1>
          <p class="lede">A submission starts a technical relay check and public-listing review. It does not guarantee publication or ranking.</p>
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
                  <span>Category</span>
                  <select name="category" required>
                    <option value="">Choose a category</option>
                    ${categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("")}
                  </select>
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

  const renderTray = () => {
    if (!state.compare.length) {
      tray.hidden = true;
      tray.innerHTML = "";
      document.body.classList.remove("has-compare-tray");
      return;
    }
    const selected = state.compare.map((id) => communities.find((item) => item.id === id)).filter(Boolean);
    tray.hidden = false;
    document.body.classList.add("has-compare-tray");
    tray.innerHTML = `
      <div class="compare-tray__inner">
        <div class="compare-count">
          <strong>${selected.length} of 3 selected</strong>
          <span>${selected.length < 2 ? "Choose one more" : "Ready to compare"}</span>
        </div>
        <div class="compare-selections" aria-label="Selected communities">
          ${selected.map((item) => `
            <div class="compare-chip">
              <span>${escapeHtml(item.name)}</span>
              <button class="remove-button" type="button" data-remove-compare="${item.id}" aria-label="Remove ${escapeHtml(item.name)} from comparison">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
              </button>
            </div>
          `).join("")}
        </div>
        <div class="compare-actions">
          <button class="button button--quiet" type="button" data-clear-compare>Clear</button>
          <button class="button button--primary" type="button" data-open-compare ${selected.length < 2 ? "disabled" : ""}>
            Compare ${selected.length}
          </button>
        </div>
      </div>
    `;
  };

  const syncFilterDialog = () => {
    const category = document.querySelector("#mobile-category");
    const focus = document.querySelector("#mobile-focus");
    const verification = document.querySelector("#mobile-verification");
    const activity = document.querySelector("#mobile-activity");
    const sort = document.querySelector("#mobile-sort");
    if (category) category.innerHTML = optionMarkup(["All", ...categories], state.category);
    if (focus) focus.value = state.focusArea;
    if (verification) verification.value = state.verification;
    if (activity) activity.value = state.activityFilter;
    if (sort) sort.value = state.sort;
  };

  const render = () => {
    setActiveNavigation();
    if (state.view === "community") renderCommunity();
    else if (state.view === "compare") renderComparison();
    else if (state.view === "method") renderMethod();
    else if (state.view === "submit") renderSubmit();
    else renderDirectory();
    renderTray();
    syncFilterDialog();
    if (shouldFocusHeading) {
      const heading = document.querySelector("#page-title");
      if (heading) heading.focus({ preventScroll: false });
      announce(`${heading?.textContent || "Page"} loaded.`);
      shouldFocusHeading = false;
    }
  };

  const updateFilters = ({ category, focusArea, verification, activityFilter, sort, q } = {}) => {
    if (category !== undefined) state.category = category;
    if (focusArea !== undefined) state.focusArea = focusArea;
    if (verification !== undefined) state.verification = verification;
    if (activityFilter !== undefined) state.activityFilter = activityFilter;
    if (sort !== undefined) state.sort = sort;
    if (q !== undefined) state.q = q;
    state.directoryStatus = "ready";
    state.view = "directory";
    writeUrl();
    renderDirectory();
    renderTray();
    syncFilterDialog();
  };

  const toggleCompare = (id) => {
    const community = communities.find((item) => item.id === id);
    if (!community) return;
    if (state.compare.includes(id)) {
      state.compare = state.compare.filter((item) => item !== id);
      announce(`${community.name} removed from comparison. ${state.compare.length} of 3 selected.`);
    } else if (state.compare.length >= 3) {
      announce("Comparison is full. Remove a community before adding another.");
      return;
    } else {
      state.compare.push(id);
      announce(`${community.name} added to comparison. ${state.compare.length} of 3 selected.`);
    }
    writeUrl();
    render();
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
      renderTray();
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
    const compare = event.target.closest("[data-compare-id]");
    if (compare) {
      toggleCompare(compare.dataset.compareId);
      return;
    }
    const remove = event.target.closest("[data-remove-compare]");
    if (remove) {
      toggleCompare(remove.dataset.removeCompare);
      return;
    }
    if (event.target.closest("[data-open-compare]")) {
      navigate("compare");
      return;
    }
    if (event.target.closest("[data-clear-compare]")) {
      state.compare = [];
      writeUrl();
      render();
      announce("Comparison selection cleared.");
      return;
    }
    if (event.target.closest("[data-clear-filters]")) {
      updateFilters({ category: "All", focusArea: "Any", verification: "Any", activityFilter: "Any", sort: "rank", q: "" });
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
    if (event.target.id === "category-filter") updateFilters({ category: event.target.value });
    if (event.target.id === "focus-filter") updateFilters({ focusArea: event.target.value });
    if (event.target.id === "verification-filter") updateFilters({ verification: event.target.value });
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
        category: document.querySelector("#mobile-category").value,
        focusArea: document.querySelector("#mobile-focus").value,
        verification: document.querySelector("#mobile-verification").value,
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
