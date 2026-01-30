/**
 * Revamp Admin Panel - Domain Profiles
 * ES5 compatible for Safari 9 / iOS 9 support
 */

(function() {
  'use strict';

  var UI = window.RevampUI;
  var API = window.RevampAPI;

  var profiles = [];
  var editingProfile = null;

  /**
   * Render profiles table
   */
  function renderProfiles() {
    var tbody = document.getElementById('profiles-tbody');
    var countEl = document.getElementById('profile-count');

    if (!tbody) return;

    var searchTerm = (document.getElementById('search-input').value || '').toLowerCase();
    var filtered = profiles.filter(function(p) {
      if (!searchTerm) return true;
      return p.name.toLowerCase().indexOf(searchTerm) !== -1 ||
        p.patterns.some(function(pat) {
          return pat.pattern.toLowerCase().indexOf(searchTerm) !== -1;
        });
    });

    if (countEl) {
      countEl.textContent = filtered.length;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding: 40px;">' +
        (searchTerm ? 'No profiles match your search' : 'No domain profiles yet. Create one to get started!') +
        '</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function(profile) {
      var patternsHtml = profile.patterns.slice(0, 3).map(function(p) {
        var tagClass = 'pattern-tag pattern-tag-' + p.type;
        return '<span class="' + tagClass + '">' + UI.escapeHtml(p.pattern) + '</span>';
      }).join('');

      if (profile.patterns.length > 3) {
        patternsHtml += '<span class="pattern-tag">+' + (profile.patterns.length - 3) + ' more</span>';
      }

      var filtersHtml = [];
      if (profile.removeAds) filtersHtml.push('<span class="badge badge-success">Ads</span>');
      if (profile.removeTracking) filtersHtml.push('<span class="badge badge-primary">Tracking</span>');
      if (filtersHtml.length === 0) filtersHtml.push('<span class="badge">None</span>');

      var statusBadge = profile.enabled
        ? '<span class="badge badge-success">Enabled</span>'
        : '<span class="badge badge-error">Disabled</span>';

      return '<tr class="profile-row" data-id="' + profile.id + '">' +
        '<td><strong>' + UI.escapeHtml(profile.name) + '</strong></td>' +
        '<td class="patterns-cell"><div class="pattern-list">' + patternsHtml + '</div></td>' +
        '<td>' + profile.priority + '</td>' +
        '<td>' + filtersHtml.join(' ') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td class="actions-cell">' +
          '<button class="btn btn-icon btn-secondary edit-btn" title="Edit">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button> ' +
          '<button class="btn btn-icon btn-secondary toggle-btn" title="Toggle">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/></svg>' +
          '</button> ' +
          '<button class="btn btn-icon btn-danger delete-btn" title="Delete">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    // Bind row actions
    tbody.querySelectorAll('.edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var row = e.target.closest('tr');
        var id = row.getAttribute('data-id');
        editProfile(id);
      });
    });

    tbody.querySelectorAll('.toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var row = e.target.closest('tr');
        var id = row.getAttribute('data-id');
        toggleProfile(id);
      });
    });

    tbody.querySelectorAll('.delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var row = e.target.closest('tr');
        var id = row.getAttribute('data-id');
        deleteProfile(id);
      });
    });
  }

  /**
   * Load profiles from API
   */
  function loadProfiles() {
    API.getDomains()
      .then(function(data) {
        profiles = data.profiles || [];
        renderProfiles();
      })
      .catch(function(err) {
        console.error('Failed to load profiles:', err);
        UI.showToast('Failed to load profiles', 'error');
      });
  }

  /**
   * Show profile editor modal
   * @param {Object|null} profile - Profile to edit (null for new)
   */
  function showProfileModal(profile) {
    editingProfile = profile;
    var isNew = !profile;

    var template = document.getElementById('profile-modal-template');
    var content = template.innerHTML;

    var modal = UI.showModal({
      title: isNew ? 'Create Profile' : 'Edit Profile',
      content: content,
      buttons: [
        {
          text: 'Cancel',
          class: 'btn-secondary',
          onClick: function() { UI.closeModal(); }
        },
        {
          text: isNew ? 'Create' : 'Save',
          class: 'btn-primary',
          onClick: function() { saveProfile(); }
        }
      ]
    });

    // Initialize form
    var form = modal.querySelector('#profile-form');

    // Populate form if editing
    if (profile) {
      form.name.value = profile.name || '';
      form.priority.value = profile.priority || 0;
      form.removeAds.checked = profile.removeAds !== false;
      form.removeTracking.checked = profile.removeTracking !== false;
      form.enabled.checked = profile.enabled !== false;

      // Transform toggles
      if (profile.transforms) {
        form.transformJs.checked = profile.transforms.transformJs === true;
        form.transformCss.checked = profile.transforms.transformCss === true;
        form.transformHtml.checked = profile.transforms.transformHtml === true;
        form.bundleEsModules.checked = profile.transforms.bundleEsModules === true;
      }

      // Custom patterns
      if (profile.customAdPatterns) {
        form.customAdPatterns.value = profile.customAdPatterns.join('\n');
      }
      if (profile.customAdSelectors) {
        form.customAdSelectors.value = profile.customAdSelectors.join('\n');
      }
      if (profile.customTrackingPatterns) {
        form.customTrackingPatterns.value = profile.customTrackingPatterns.join('\n');
      }
      if (profile.customTrackingSelectors) {
        form.customTrackingSelectors.value = profile.customTrackingSelectors.join('\n');
      }
    }

    // Initialize pattern editor
    initPatternEditor(modal, profile ? profile.patterns : []);

    // Advanced toggle
    var advancedToggle = modal.querySelector('#advanced-toggle');
    var advancedContent = modal.querySelector('#advanced-content');
    advancedToggle.addEventListener('click', function() {
      advancedContent.classList.toggle('show');
    });
  }

  /**
   * Initialize pattern editor
   */
  function initPatternEditor(modal, patterns) {
    var editor = modal.querySelector('#pattern-editor');
    var addBtn = modal.querySelector('#add-pattern-btn');

    function renderPatterns() {
      editor.innerHTML = patterns.map(function(p, i) {
        return '<div class="pattern-row" data-index="' + i + '">' +
          '<select class="form-select pattern-type">' +
            '<option value="exact"' + (p.type === 'exact' ? ' selected' : '') + '>Exact</option>' +
            '<option value="suffix"' + (p.type === 'suffix' ? ' selected' : '') + '>Suffix (*)</option>' +
            '<option value="regex"' + (p.type === 'regex' ? ' selected' : '') + '>Regex</option>' +
          '</select>' +
          '<input type="text" class="form-input pattern-value" value="' + UI.escapeHtml(p.pattern) + '" placeholder="*.example.com">' +
          '<button type="button" class="btn btn-icon btn-danger remove-pattern-btn">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>';
      }).join('');

      // Bind remove buttons
      editor.querySelectorAll('.remove-pattern-btn').forEach(function(btn, i) {
        btn.addEventListener('click', function() {
          patterns.splice(i, 1);
          renderPatterns();
        });
      });

      // Bind input changes
      editor.querySelectorAll('.pattern-row').forEach(function(row, i) {
        row.querySelector('.pattern-type').addEventListener('change', function(e) {
          patterns[i].type = e.target.value;
        });
        row.querySelector('.pattern-value').addEventListener('input', function(e) {
          patterns[i].pattern = e.target.value;
        });
      });
    }

    // Add empty pattern if none exist
    if (patterns.length === 0) {
      patterns.push({ type: 'suffix', pattern: '' });
    }

    renderPatterns();

    addBtn.addEventListener('click', function() {
      patterns.push({ type: 'suffix', pattern: '' });
      renderPatterns();
    });

    // Store patterns reference on editor for retrieval
    editor._patterns = patterns;
  }

  /**
   * Save profile (create or update)
   */
  function saveProfile() {
    var modal = document.querySelector('.modal');
    var form = modal.querySelector('#profile-form');
    var editor = modal.querySelector('#pattern-editor');

    var name = form.name.value.trim();
    var patterns = editor._patterns.filter(function(p) {
      return p.pattern.trim() !== '';
    });

    if (!name) {
      UI.showToast('Profile name is required', 'error');
      return;
    }

    if (patterns.length === 0) {
      UI.showToast('At least one pattern is required', 'error');
      return;
    }

    // Build transforms object
    var transforms = {};
    if (form.transformJs.checked) transforms.transformJs = true;
    if (form.transformCss.checked) transforms.transformCss = true;
    if (form.transformHtml.checked) transforms.transformHtml = true;
    if (form.bundleEsModules.checked) transforms.bundleEsModules = true;

    // Build profile data
    var profileData = {
      name: name,
      priority: parseInt(form.priority.value, 10) || 0,
      patterns: patterns,
      removeAds: form.removeAds.checked,
      removeTracking: form.removeTracking.checked,
      enabled: form.enabled.checked,
      transforms: Object.keys(transforms).length > 0 ? transforms : undefined
    };

    // Custom patterns (parse from textarea)
    var customAdPatterns = parseLines(form.customAdPatterns.value);
    var customAdSelectors = parseLines(form.customAdSelectors.value);
    var customTrackingPatterns = parseLines(form.customTrackingPatterns.value);
    var customTrackingSelectors = parseLines(form.customTrackingSelectors.value);

    if (customAdPatterns.length > 0) profileData.customAdPatterns = customAdPatterns;
    if (customAdSelectors.length > 0) profileData.customAdSelectors = customAdSelectors;
    if (customTrackingPatterns.length > 0) profileData.customTrackingPatterns = customTrackingPatterns;
    if (customTrackingSelectors.length > 0) profileData.customTrackingSelectors = customTrackingSelectors;

    UI.showLoading('Saving profile...');

    var promise = editingProfile
      ? API.updateDomain(editingProfile.id, profileData)
      : API.createDomain(profileData);

    promise
      .then(function() {
        UI.hideLoading();
        UI.closeModal();
        UI.showToast(editingProfile ? 'Profile updated' : 'Profile created', 'success');
        loadProfiles();
      })
      .catch(function(err) {
        UI.hideLoading();
        console.error('Failed to save profile:', err);
        UI.showToast(err.data?.error || 'Failed to save profile', 'error');
      });
  }

  /**
   * Parse lines from textarea
   */
  function parseLines(text) {
    if (!text) return [];
    return text.split('\n')
      .map(function(line) { return line.trim(); })
      .filter(function(line) { return line !== ''; });
  }

  /**
   * Edit a profile
   */
  function editProfile(id) {
    var profile = profiles.find(function(p) { return p.id === id; });
    if (profile) {
      showProfileModal(profile);
    }
  }

  /**
   * Toggle profile enabled status
   */
  function toggleProfile(id) {
    var profile = profiles.find(function(p) { return p.id === id; });
    if (!profile) return;

    API.updateDomain(id, { enabled: !profile.enabled })
      .then(function() {
        UI.showToast('Profile ' + (profile.enabled ? 'disabled' : 'enabled'), 'success');
        loadProfiles();
      })
      .catch(function(err) {
        console.error('Failed to toggle profile:', err);
        UI.showToast('Failed to toggle profile', 'error');
      });
  }

  /**
   * Delete a profile
   */
  function deleteProfile(id) {
    var profile = profiles.find(function(p) { return p.id === id; });
    if (!profile) return;

    UI.confirm('Are you sure you want to delete "' + profile.name + '"?', {
      title: 'Delete Profile',
      confirmText: 'Delete',
      danger: true
    }).then(function(confirmed) {
      if (!confirmed) return;

      API.deleteDomain(id)
        .then(function() {
          UI.showToast('Profile deleted', 'success');
          loadProfiles();
        })
        .catch(function(err) {
          console.error('Failed to delete profile:', err);
          UI.showToast('Failed to delete profile', 'error');
        });
    });
  }

  /**
   * Test domain matching
   */
  function testDomain() {
    var input = document.getElementById('test-domain-input');
    var resultEl = document.getElementById('tester-result');
    var domain = input.value.trim();

    if (!domain) {
      UI.showToast('Please enter a domain', 'error');
      return;
    }

    API.testDomain(domain)
      .then(function(data) {
        resultEl.classList.remove('hidden');

        if (data.matched && data.profile) {
          resultEl.className = 'tester-result match';
          resultEl.innerHTML = '<strong>Match found!</strong><br>' +
            'Profile: <strong>' + UI.escapeHtml(data.profile.name) + '</strong><br>' +
            'Pattern: <code>' + UI.escapeHtml(data.matchedPattern?.pattern || 'N/A') + '</code> (' + (data.matchedPattern?.type || 'N/A') + ')';
        } else {
          resultEl.className = 'tester-result no-match';
          resultEl.innerHTML = '<strong>No match</strong><br>' +
            'No profile matches this domain. Global defaults will be used.';
        }
      })
      .catch(function(err) {
        console.error('Failed to test domain:', err);
        UI.showToast('Failed to test domain', 'error');
      });
  }

  /**
   * Initialize
   */
  function init() {
    loadProfiles();

    // Create button
    var createBtn = document.getElementById('create-profile-btn');
    if (createBtn) {
      createBtn.addEventListener('click', function() {
        showProfileModal(null);
      });
    }

    // Search input
    var searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', UI.debounce(renderProfiles, 300));
    }

    // Domain tester
    var testBtn = document.getElementById('test-domain-btn');
    var testInput = document.getElementById('test-domain-input');
    if (testBtn) {
      testBtn.addEventListener('click', testDomain);
    }
    if (testInput) {
      testInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') testDomain();
      });
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
