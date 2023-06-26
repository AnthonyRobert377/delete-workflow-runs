const core = require("@actions/core");

async function run() {
    try {
        // Fetch all the inputs
        const token = core.getInput('token');
        const url = core.getInput('baseUrl');
        const repository = core.getInput('repository');
        const retain_days = Number(core.getInput('retain_days'));
        const keep_minimum_runs = Number(core.getInput('keep_minimum_runs'));
        const delete_workflow_pattern = core.getInput('delete_workflow_pattern');
        const delete_workflow_by_state_pattern = core.getInput('delete_workflow_by_state_pattern');
        const delete_run_by_conclusion_pattern = core.getInput('delete_run_by_conclusion_pattern');
        const dry_run = core.getInput('dry_run');

        // Split the input 'repository' (format {owner}/{repo}) to be {owner} and {repo}
        const splitRepository = repository.split('/');
        if (splitRepository.length !== 2 || !splitRepository[0] || !splitRepository[1]) {
            throw new Error(`Invalid repository '${repository}'. Expected format {owner}/{repo}.`);
        }
        const repo_owner = splitRepository[0];
        const repo_name = splitRepository[1];

        const { Octokit } = require("@octokit/rest");
        const octokit = new Octokit({ auth: token, baseUrl: url });

        let workflows = await octokit.paginate("GET /repos/:owner/:repo/actions/workflows", {
            owner: repo_owner,
            repo: repo_name,
        });

        if (delete_workflow_pattern && delete_workflow_pattern.toLowerCase() !== "all") {
            console.log(`💬 workflows containing '${delete_workflow_pattern}' will be targeted`);
            workflows = workflows.filter(({ name, path }) => {
                const filename = path.replace(".github/workflows/");
                return [name, filename].some(x => x.indexOf(delete_workflow_pattern) !== -1);
            });
        }

        if (delete_workflow_by_state_pattern && delete_workflow_by_state_pattern.toLowerCase() !== "all") {
            console.log(`💬 workflows containing state '${delete_workflow_by_state_pattern}' will be targeted`);
            workflows = workflows.filter(({ state }) => state.indexOf(delete_workflow_by_state_pattern) !== -1);
        }

        let totalWorkflowRuns = 0;

        for (const workflow of workflows) {
            core.debug(`Workflow: ${workflow.name} ${workflow.id} ${workflow.state}`);
            let del_runs = new Array();
            let Skip_runs = new Array();

            const runs = await octokit.paginate("GET /repos/:owner/:repo/actions/workflows/:workflow_id/runs", {
                owner: repo_owner,
                repo: repo_name,
                workflow_id: workflow.id
            });

            totalWorkflowRuns += runs.length;

            for (const run of runs) {
                core.debug(`Run: '${workflow.name}' workflow run ${run.id} (status=${run.status})`);
                if (run.status !== "completed") {
                    console.log(`⏭️ Skipped: ${workflow.name} - https://github.com/Jumpman-Frontend/jumpman-sites/actions/runs/${run.id} - Reason: ${run.status}`);
                    continue;
                }
                if (delete_run_by_conclusion_pattern && delete_run_by_conclusion_pattern.toLowerCase() !== "all"
                    && run.conclusion.indexOf(delete_run_by_conclusion_pattern) === -1) {
                    core.debug(`  Skipping '${workflow.name}' workflow run ${run.id} because conclusion was ${run.conclusion}`);
                    continue;
                }
                const created_at = new Date(run.created_at);
                const current = new Date();
                const ELAPSE_ms = current.getTime() - created_at.getTime();
                const ELAPSE_days = ELAPSE_ms / (1000 * 3600 * 24);
                if (ELAPSE_days >= retain_days) {
                    core.debug(`  Added to del list '${workflow.name}' workflow run ${run.id}`);
                    del_runs.push(run);
                } else {
                    console.log(`⏭️ Skipped: ${workflow.name} - https://github.com/Jumpman-Frontend/jumpman-sites/actions/runs/${run.id} - Executed: ${run.created_at}`);
                }
            }

            core.debug(`Delete list for '${workflow.name}' is ${del_runs.length} items`);
            const arr_length = del_runs.length - keep_minimum_runs;
            if (arr_length > 0) {
                del_runs = del_runs.sort((a, b) => { return a.id - b.id; });
                if (keep_minimum_runs !== 0) {
                    Skip_runs = del_runs.slice(-keep_minimum_runs);
                    del_runs = del_runs.slice(0, -keep_minimum_runs);
                    for (const Skipped of Skip_runs) {
                        console.log(`⏭️ Skipped: ${workflow.name} - https://github.com/Jumpman-Frontend/jumpman-sites/actions/runs/${Skipped.id} - Executed: ${Skipped.created_at}`);
                    }
                }
                core.debug(`Deleting ${del_runs.length} runs for '${workflow.name}' workflow`);
                for (const del of del_runs) {
                    core.debug(`Deleting '${workflow.name}' workflow run ${del.id}`);
                    if (dry_run) {
                        console.log(`🗑️ Delete: ${workflow.name} - #${del.id}`);
                        continue;
                    }
                    await octokit.actions.deleteWorkflowRun({
                        owner: repo_owner,
                        repo: repo_name,
                        run_id: del.id
                    });
                    console.log(`🗑️ Deleted: ${workflow.name} - #${del.id}`);
                }
                console.log(`----------------------------------------------------------------`);
                console.log(`✅ Jobs deleted: ${arr_length}`);
            }
        }

        console.log(`🔎 Jobs found: ${totalWorkflowRuns}`);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
