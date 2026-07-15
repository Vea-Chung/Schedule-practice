// solver.js - Timetable Scheduler Solver Engine (Backtracking with Relaxation)

const RosterSolver = (() => {

    // Helper to generate array of dates between start and end
    function getDatesInRange(startDate, endDate) {
        const dates = [];
        let curr = new Date(startDate);
        const end = new Date(endDate);
        while (curr <= end) {
            dates.push(new Date(curr).toISOString().split('T')[0]);
            curr.setDate(curr.getDate() + 1);
        }
        return dates;
    }

    // Solve function
    function solve(inputData, config) {
        const { startDate, endDate, weekendSat, weekendSun } = config;
        const days = getDatesInRange(startDate, endDate);
        const defaultHours = Number(inputData.Setup.find(r => r.Parameter === "Default Daily Work Hours")?.Value || 8);

        // Preprocess Resources
        const resources = inputData.Resources.map(r => {
            const absentList = new Set();
            // User absences
            const absentStr = String(r["Absent Dates"] || '').trim();
            if (absentStr) {
                absentStr.split(',').forEach(d => {
                    const cleanD = d.trim();
                    if (cleanD) absentList.add(cleanD);
                });
            }
            // Weekend absences
            days.forEach(dateStr => {
                const dayOfWeek = new Date(dateStr).getDay(); // 0 = Sunday, 6 = Saturday
                if (weekendSat && dayOfWeek === 6) absentList.add(dateStr);
                if (weekendSun && dayOfWeek === 0) absentList.add(dateStr);
            });

            return {
                name: r["Resource Name"],
                absences: absentList,
                minHours: Number(r["Min Hours"] || 0),
                maxHours: Number(r["Max Hours"] || 9999),
                row: r
            };
        });

        // Preprocess Departments
        const departments = inputData.Departments.map(d => ({
            name: d["Department Name"],
            minHours: Number(d["Min Total Hours"] || 0),
            maxHours: Number(d["Max Total Hours"] || 9999),
            row: d
        }));

        // Preprocess Mappings (Resource capability + min/max days in dept)
        const mappings = {};
        inputData.Mappings.forEach(m => {
            const res = m["Resource Name"];
            const dept = m["Department Name"];
            if (!mappings[res]) mappings[res] = {};
            mappings[res][dept] = {
                minDays: Number(m["Min Days"] || 0),
                maxDays: Number(m["Max Days"] || 9999)
            };
        });

        // Slot variables to fill: for each day, for each department, assign a resource name (or null)
        const slots = [];
        days.forEach(day => {
            departments.forEach(dept => {
                slots.push({ day, deptName: dept.name });
            });
        });

        // We want to generate multiple alternate schedules.
        const maxAlternates = 5;
        const validSchedules = [];

        // Backtracking state
        // assignment key format: "day:deptName" -> resourceName or null
        const currentAssignment = {};
        
        // Helper to check feasibility of a step during backtracking
        function isFeasible(slotIndex, resourceName) {
            const slot = slots[slotIndex];
            const day = slot.day;
            const deptName = slot.deptName;

            if (resourceName === null) return true; // Empty slot is always feasible in step

            // 1. Absence constraint
            const res = resources.find(r => r.name === resourceName);
            if (res.absences.has(day)) return false;

            // 2. Double-booking constraint (resource cannot work two departments on same day)
            for (const otherDept of departments) {
                if (otherDept.name !== deptName) {
                    if (currentAssignment[`${day}:${otherDept.name}`] === resourceName) {
                        return false;
                    }
                }
            }

            // 3. Mapping capability constraint
            if (!mappings[resourceName] || !mappings[resourceName][deptName]) {
                return false;
            }

            // 4. Max days in department check (early pruning)
            let deptDayCount = 1; // Count this prospective assignment
            for (let i = 0; i < slotIndex; i++) {
                const s = slots[i];
                if (s.deptName === deptName && currentAssignment[`${s.day}:${s.deptName}`] === resourceName) {
                    deptDayCount++;
                }
            }
            const limit = mappings[resourceName][deptName].maxDays;
            if (deptDayCount > limit) return false;

            // 5. Max hours of resource check (early pruning)
            let totalResHours = defaultHours;
            for (let i = 0; i < slotIndex; i++) {
                const s = slots[i];
                if (currentAssignment[`${s.day}:${s.deptName}`] === resourceName) {
                    totalResHours += defaultHours;
                }
            }
            if (totalResHours > res.maxHours) return false;

            // 6. Max hours of department check (early pruning)
            let totalDeptHours = defaultHours;
            for (let i = 0; i < slotIndex; i++) {
                const s = slots[i];
                if (s.deptName === deptName && currentAssignment[`${s.day}:${s.deptName}`] !== null) {
                    totalDeptHours += defaultHours;
                }
            }
            const deptObj = departments.find(d => d.name === deptName);
            if (totalDeptHours > deptObj.maxHours) return false;

            return true;
        }

        // Full check of all constraints once a solution is proposed
        function verifyCompleteSchedule(assignment) {
            const violations = [];

            // Resource specific hours and department assignments count
            resources.forEach(res => {
                let hours = 0;
                const deptDays = {};
                departments.forEach(d => { deptDays[d.name] = 0; });

                slots.forEach(slot => {
                    if (assignment[`${slot.day}:${slot.deptName}`] === res.name) {
                        hours += defaultHours;
                        deptDays[slot.deptName]++;
                    }
                });

                // Resource hours checks
                if (hours < res.minHours) {
                    violations.push({
                        type: "Resource Hours Min violation",
                        severity: "warning",
                        message: `Resource "${res.name}" scheduled for ${hours} hours, which is under their minimum limit of ${res.minHours} hours.`
                    });
                }
                if (hours > res.maxHours) {
                    violations.push({
                        type: "Resource Hours Max violation",
                        severity: "critical",
                        message: `Resource "${res.name}" scheduled for ${hours} hours, exceeding their maximum limit of ${res.maxHours} hours.`
                    });
                }

                // Min Days in Dept check
                Object.keys(deptDays).forEach(deptName => {
                    const daysCount = deptDays[deptName];
                    const mapConfig = mappings[res.name]?.[deptName];
                    if (mapConfig && daysCount > 0 && daysCount < mapConfig.minDays) {
                        violations.push({
                            type: "Min Days in Department violation",
                            severity: "warning",
                            message: `Resource "${res.name}" scheduled for only ${daysCount} days in ${deptName}, under the minimum of ${mapConfig.minDays} days.`
                        });
                    }
                });
            });

            // Department total hours checks
            departments.forEach(dept => {
                let hours = 0;
                slots.forEach(slot => {
                    if (slot.deptName === dept.name && assignment[`${slot.day}:${slot.deptName}`] !== null) {
                        hours += defaultHours;
                    }
                });

                if (hours < dept.minHours) {
                    violations.push({
                        type: "Department Hours Min violation",
                        severity: "warning",
                        message: `Department "${dept.name}" served for only ${hours} hours total, under the requirement of ${dept.minHours} hours.`
                    });
                }
                if (hours > dept.maxHours) {
                    violations.push({
                        type: "Department Hours Max violation",
                        severity: "critical",
                        message: `Department "${dept.name}" served for ${hours} hours total, exceeding the limit of ${dept.maxHours} hours.`
                    });
                }
            });

            return violations;
        }

        // Backtrack solver loop
        function backtrack(slotIndex) {
            if (validSchedules.length >= maxAlternates) return;

            if (slotIndex === slots.length) {
                // Solution found! Verify soft constraints (min hours/days)
                const violations = verifyCompleteSchedule(currentAssignment);
                // In perfect solver, we only accept 0 violations or very minimal ones.
                // Let's store it as a candidate.
                const newSol = {
                    assignment: { ...currentAssignment },
                    violations: violations
                };
                
                // If it has no warnings/criticals, we save it as a primary candidate.
                validSchedules.push(newSol);
                return;
            }

            const slot = slots[slotIndex];
            const deptName = slot.deptName;

            // Try assigning each resource
            const options = [...resources.map(r => r.name), null];
            // Shuffle choices slightly to generate diverse alternates
            options.sort(() => Math.random() - 0.5);

            for (const resName of options) {
                if (isFeasible(slotIndex, resName)) {
                    currentAssignment[`${slot.day}:${deptName}`] = resName;
                    backtrack(slotIndex + 1);
                    currentAssignment[`${slot.day}:${deptName}`] = null; // revert
                }
            }
        }

        // Run primary search
        backtrack(0);

        // Filter for ideal schedules (zero violations)
        const perfectSchedules = validSchedules.filter(s => s.violations.length === 0);

        if (perfectSchedules.length > 0) {
            return {
                status: "Success",
                schedules: perfectSchedules.map(s => s.assignment),
                violationsList: perfectSchedules.map(s => s.violations)
            };
        }

        // If no perfect schedule exists, we fallback to finding a relaxed schedule that minimizes violations.
        // We do a branch and bound search (or local search heuristic) to minimize violations penalty count.
        // Let's implement a heuristic relaxation solver.
        const relaxedSolution = runHeuristicRelaxation(slots, resources, departments, mappings, defaultHours, days);

        return {
            status: "Feasible With Violations",
            schedules: [relaxedSolution.assignment],
            violationsList: [relaxedSolution.violations]
        };
    }

    // Runs optimization with penalty coefficients to generate the best possible roster with minimal violations
    function runHeuristicRelaxation(slots, resources, departments, mappings, defaultHours, days) {
        // We will assign resources greedily to slots to satisfy core physical feasibility (absence, mapping availability, double-booking).
        // Then we evaluate the penalty and perform randomized local searches to improve the result.
        
        let bestAssignment = null;
        let bestViolations = [];
        let bestScore = Infinity;

        // Perform 250 local search iterations
        for (let iter = 0; iter < 250; iter++) {
            const current = {};
            
            // Build random feasible base
            slots.forEach(slot => {
                const day = slot.day;
                const deptName = slot.deptName;

                // Find valid resources who aren't absent and are mapped to this department
                const eligible = resources.filter(res => {
                    // Check absent
                    if (res.absences.has(day)) return false;
                    // Check capability
                    if (!mappings[res.name]?.[deptName]) return false;
                    // Check if already assigned today
                    for (const otherDept of departments) {
                        if (current[`${day}:${otherDept.name}`] === res.name) return false;
                    }
                    return true;
                });

                if (eligible.length > 0 && Math.random() > 0.1) {
                    const picked = eligible[Math.floor(Math.random() * eligible.length)];
                    current[`${day}:${deptName}`] = picked.name;
                } else {
                    current[`${day}:${deptName}`] = null;
                }
            });

            // Evaluate penalty score
            const violations = evaluatePenalty(current, slots, resources, departments, mappings, defaultHours);
            const score = computeViolationScore(violations);

            if (score < bestScore) {
                bestScore = score;
                bestAssignment = { ...current };
                bestViolations = violations;
            }
        }

        // Return best relaxed roster
        return {
            assignment: bestAssignment || {},
            violations: bestViolations
        };
    }

    function evaluatePenalty(assignment, slots, resources, departments, mappings, defaultHours) {
        const violations = [];

        resources.forEach(res => {
            let hours = 0;
            const deptDays = {};
            departments.forEach(d => { deptDays[d.name] = 0; });

            slots.forEach(slot => {
                if (assignment[`${slot.day}:${slot.deptName}`] === res.name) {
                    hours += defaultHours;
                    deptDays[slot.deptName]++;
                }
            });

            if (hours < res.minHours) {
                violations.push({
                    type: "Resource Hours Min violation",
                    severity: "warning",
                    message: `Resource "${res.name}" works ${hours} hours, missing their minimum quota of ${res.minHours} hours.`
                });
            }
            if (hours > res.maxHours) {
                violations.push({
                    type: "Resource Hours Max violation",
                    severity: "critical",
                    message: `Resource "${res.name}" scheduled for ${hours} hours, exceeding max capacity of ${res.maxHours} hours.`
                });
            }

            Object.keys(deptDays).forEach(deptName => {
                const count = deptDays[deptName];
                const limit = mappings[res.name]?.[deptName];
                if (limit && count > 0 && count < limit.minDays) {
                    violations.push({
                        type: "Min Days in Department violation",
                        severity: "warning",
                        message: `Resource "${res.name}" served for only ${count} days in "${deptName}", under the minimum of ${limit.minDays} days.`
                    });
                }
            });
        });

        departments.forEach(dept => {
            let hours = 0;
            slots.forEach(slot => {
                if (slot.deptName === dept.name && assignment[`${slot.day}:${slot.deptName}`] !== null) {
                    hours += defaultHours;
                }
            });

            if (hours < dept.minHours) {
                violations.push({
                    type: "Department Hours Min violation",
                    severity: "warning",
                    message: `Department "${dept.name}" served for only ${hours} hours total, missing required minimum of ${dept.minHours} hours.`
                });
            }
            if (hours > dept.maxHours) {
                violations.push({
                    type: "Department Hours Max violation",
                    severity: "critical",
                    message: `Department "${dept.name}" served for ${hours} hours total, exceeding maximum of ${dept.maxHours} hours.`
                });
            }
        });

        return violations;
    }

    function computeViolationScore(violations) {
        let score = 0;
        violations.forEach(v => {
            if (v.severity === 'critical') score += 100;
            if (v.severity === 'warning') score += 10;
        });
        return score;
    }

    return {
        solve
    };

})();
