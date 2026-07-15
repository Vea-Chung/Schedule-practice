// app.js - Timetable Scheduler Orchestration & UI Renderer

let uploadedData = null; // Stores parsed spreadsheet data globally
let solverResults = null; // Stores solver output globally
let currentScheduleIndex = 0; // Tracks which alternate schedule is viewed

document.addEventListener('DOMContentLoaded', () => {
    // Modal Selectors
    const howToUseBtn = document.getElementById('howToUseBtn');
    const howToUseModal = document.getElementById('howToUseModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const closeModalFooterBtn = document.getElementById('closeModalFooterBtn');

    // Modal Events
    const openModal = () => howToUseModal.classList.remove('hidden');
    const closeModal = () => howToUseModal.classList.add('hidden');

    howToUseBtn.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);
    closeModalFooterBtn.addEventListener('click', closeModal);

    howToUseModal.addEventListener('click', (e) => {
        if (e.target === howToUseModal) {
            closeModal();
        }
    });

    // Tab switching support
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetTab = btn.getAttribute('data-tab');
            document.getElementById(targetTab).classList.add('active');
        });
    });

    // --- Excel template actions ---
    const downloadBtn = document.getElementById('downloadTemplateBtn');
    const downloadWelcomeBtn = document.getElementById('downloadTemplateWelcomeBtn');

    const triggerDownload = () => {
        ExcelTemplateManager.downloadTemplate();
    };

    downloadBtn.addEventListener('click', triggerDownload);
    downloadWelcomeBtn.addEventListener('click', triggerDownload);

    // --- File upload zone actions ---
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('excelFileInput');
    const statusNotification = document.getElementById('statusNotification');

    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = 'var(--primary)';
        uploadZone.style.backgroundColor = 'var(--primary-light)';
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.style.borderColor = 'var(--border-color)';
        uploadZone.style.backgroundColor = 'var(--bg-main)';
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = 'var(--border-color)';
        uploadZone.style.backgroundColor = 'var(--bg-main)';
        
        if (e.dataTransfer.files.length > 0) {
            handleUploadedFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleUploadedFile(e.target.files[0]);
        }
    });

    function showStatus(title, message, type = 'info') {
        statusNotification.className = `alert alert-${type}`;
        statusNotification.querySelector('.alert-title').textContent = title;
        statusNotification.querySelector('.alert-message').innerHTML = message;
        statusNotification.classList.remove('hidden');
    }

    function hideStatus() {
        statusNotification.classList.add('hidden');
    }

    function handleUploadedFile(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = e.target.result;
            const result = ExcelTemplateManager.parseAndValidate(data);

            if (result.error) {
                showStatus('File Error', result.error, 'danger');
                uploadedData = null;
            } else if (result.errors && result.errors.length > 0) {
                const formattedErrors = result.errors.map(err => `<li>${err}</li>`).join('');
                showStatus(
                    'Validation Error(s) in Template', 
                    `<p>Please correct the following errors and re-upload:</p><ul style="margin-top:0.5rem; padding-left:1.25rem; font-size:0.8rem;">${formattedErrors}</ul>`, 
                    'danger'
                );
                uploadedData = null;
            } else {
                uploadedData = result.data;
                
                const setupMap = {};
                uploadedData.Setup.forEach(row => {
                    setupMap[row["Parameter"]] = row["Value"];
                });

                if (setupMap["Start Date"]) {
                    document.getElementById('startDate').value = formatDateVal(setupMap["Start Date"]);
                }
                if (setupMap["End Date"]) {
                    document.getElementById('endDate').value = formatDateVal(setupMap["End Date"]);
                }

                showStatus(
                    'Success', 
                    `Successfully loaded file <strong>"${file.name}"</strong>. Verified details for ${uploadedData.Resources.length} resources and ${uploadedData.Departments.length} departments. You can now adjust planning dates and click "Generate Schedule".`, 
                    'info'
                );
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function formatDateVal(val) {
        if (typeof val === 'number') {
            const date = new Date((val - 25569) * 86400 * 1000);
            return date.toISOString().split('T')[0];
        }
        if (val instanceof Date) {
            return val.toISOString().split('T')[0];
        }
        return String(val).trim();
    }

    // --- Generate Schedule Action ---
    const generateBtn = document.getElementById('generateScheduleBtn');
    generateBtn.addEventListener('click', () => {
        if (!uploadedData) {
            showStatus('Error', 'Please upload a completed Excel template before generating a schedule.', 'danger');
            return;
        }

        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const weekendSat = document.getElementById('weekendSat').checked;
        const weekendSun = document.getElementById('weekendSun').checked;
        
        if (!startDate || !endDate) {
            showStatus('Error', 'Please configure valid Start Date and End Date.', 'danger');
            return;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start > end) {
            showStatus('Error', 'Start Date cannot be after End Date.', 'danger');
            return;
        }

        // Display Loader
        document.getElementById('welcomeScreen').classList.add('hidden');
        document.getElementById('outputContainer').classList.add('hidden');
        document.getElementById('loader').classList.remove('hidden');

        setTimeout(() => {
            try {
                // Execute Solver
                solverResults = RosterSolver.solve(uploadedData, {
                    startDate,
                    endDate,
                    weekendSat,
                    weekendSun
                });

                document.getElementById('loader').classList.add('hidden');
                document.getElementById('outputContainer').classList.remove('hidden');

                // Render Results
                currentScheduleIndex = 0;
                renderAlternatesBar();
                renderSelectedSchedule();

                // Status Update
                if (solverResults.status === "Success") {
                    showStatus('Optimization Complete', `Roster generated successfully with <strong>zero violations</strong>. Found ${solverResults.schedules.length} alternative schedule options.`, 'info');
                } else {
                    showStatus('Relaxed Roster Generated', `A complete roster could not satisfy all constraints perfectly. The solver has generated a layout with the <strong>minimum possible violations</strong>. Please check the 'Violations & Warnings' tab for details.`, 'info');
                }
            } catch (err) {
                document.getElementById('loader').classList.add('hidden');
                showStatus('Solver Engine Error', `An error occurred during constraint scheduling: ${err.message}`, 'danger');
            }
        }, 600);
    });

    // --- Render Alternates Selector ---
    function renderAlternatesBar() {
        const bar = document.getElementById('alternatesTabs');
        bar.innerHTML = '';

        const prefix = solverResults.status === "Success" ? "Schedule Option" : "Relaxed Option";
        solverResults.schedules.forEach((sch, index) => {
            const btn = document.createElement('button');
            btn.className = `alt-tab ${index === currentScheduleIndex ? 'active' : ''}`;
            btn.innerHTML = `<i class="fa-solid fa-calendar-week"></i> ${prefix} ${index + 1}`;
            btn.addEventListener('click', () => {
                document.querySelectorAll('.alt-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentScheduleIndex = index;
                renderSelectedSchedule();
            });
            bar.appendChild(btn);
        });
    }

    // Helper to generate dates list
    function getDates(start, end) {
        const list = [];
        let curr = new Date(start);
        const last = new Date(end);
        while (curr <= last) {
            list.push(new Date(curr).toISOString().split('T')[0]);
            curr.setDate(curr.getDate() + 1);
        }
        return list;
    }

    // --- Render Table & Violations Lists ---
    function renderSelectedSchedule() {
        const assignment = solverResults.schedules[currentScheduleIndex];
        const violations = solverResults.violationsList[currentScheduleIndex];
        
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const days = getDates(startDate, endDate);

        // Render Table Headers
        const thead = document.querySelector('#scheduleTable thead');
        let headerHtml = `<tr><th>Department Name</th>`;
        days.forEach(day => {
            const dateObj = new Date(day);
            const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNum = dateObj.getDate();
            const monthStr = dateObj.toLocaleDateString('en-US', { month: 'short' });
            headerHtml += `<th>${weekday}, ${monthStr} ${dayNum}</th>`;
        });
        headerHtml += `</tr>`;
        thead.innerHTML = headerHtml;

        // Render Table Body (Rows by Department)
        const tbody = document.querySelector('#scheduleTable tbody');
        tbody.innerHTML = '';

        uploadedData.Departments.forEach(dept => {
            const row = document.createElement('tr');
            let rowHtml = `<td><strong>${dept["Department Name"]}</strong></td>`;

            days.forEach(day => {
                const assigned = assignment[`${day}:${dept["Department Name"]}`];
                
                // Identify default weekend/rest day color indicator
                const dateObj = new Date(day);
                const dayOfWeek = dateObj.getDay();
                const weekendSat = document.getElementById('weekendSat').checked;
                const weekendSun = document.getElementById('weekendSun').checked;
                const isWeekend = (weekendSat && dayOfWeek === 6) || (weekendSun && dayOfWeek === 0);

                if (assigned) {
                    rowHtml += `<td><span class="cell-assigned"><i class="fa-regular fa-user"></i> ${assigned}</span></td>`;
                } else if (isWeekend) {
                    rowHtml += `<td><span class="cell-absent"><i class="fa-solid fa-bed"></i> Rest Day</span></td>`;
                } else {
                    rowHtml += `<td><span class="cell-empty">—</span></td>`;
                }
            });

            row.innerHTML = rowHtml;
            tbody.appendChild(row);
        });

        // Render Violations list
        const violsList = document.getElementById('violationsList');
        const badgeCount = document.getElementById('violationsCount');
        
        violsList.innerHTML = '';
        badgeCount.textContent = violations.length;

        if (violations.length === 0) {
            violsList.innerHTML = `
                <div class="alert alert-info">
                    <i class="fa-solid fa-circle-check alert-icon" style="color:var(--success);"></i>
                    <div class="alert-content">
                        <h4 class="alert-title">Roster Clean</h4>
                        <p class="alert-message">This schedule contains absolutely no capacity or duration constraints violations.</p>
                    </div>
                </div>
            `;
        } else {
            violations.forEach(v => {
                const item = document.createElement('div');
                item.className = `violation-card ${v.severity}`;
                
                const icon = v.severity === 'critical' 
                    ? '<i class="fa-solid fa-circle-xmark violation-icon"></i>' 
                    : '<i class="fa-solid fa-triangle-exclamation violation-icon"></i>';

                item.innerHTML = `
                    ${icon}
                    <div class="violation-desc">
                        <h4>${v.type} (${v.severity.toUpperCase()})</h4>
                        <p>${v.message}</p>
                    </div>
                `;
                violsList.appendChild(item);
            });
        }
    }

    // --- Export Results back to Excel ---
    const exportBtn = document.getElementById('exportScheduleBtn');
    exportBtn.addEventListener('click', () => {
        if (!solverResults) return;

        const table = document.getElementById('scheduleTable');
        const wb = XLSX.utils.table_to_book(table, { sheet: "Timetable Roster" });

        // Add a second sheet containing the violations log
        const violRows = [["Violation Type", "Severity", "Detail Message"]];
        const currentViolations = solverResults.violationsList[currentScheduleIndex];
        currentViolations.forEach(v => {
            violRows.push([v.type, v.severity.toUpperCase(), v.message]);
        });
        const wsViol = XLSX.utils.aoa_to_sheet(violRows);
        XLSX.utils.book_append_sheet(wb, wsViol, "Violations & Warnings");

        // Download Excel
        XLSX.writeFile(wb, `Generated_Roster_Option_${currentScheduleIndex + 1}.xlsx`);
    });
});
