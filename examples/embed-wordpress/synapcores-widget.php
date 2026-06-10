<?php
/**
 * Plugin Name: SynapCores Widget
 * Plugin URI:  https://synapcores.com
 * Description: Drop-in support chat widget powered by SynapCores. Injects one <script> tag into the site footer.
 * Version:     0.4.0
 * Author:      SynapCores
 * License:     MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

// ----- Settings page (Settings → SynapCores Widget) ----------------------

add_action('admin_menu', function () {
    add_options_page(
        'SynapCores Widget',
        'SynapCores Widget',
        'manage_options',
        'synapcores-widget',
        'synapcores_widget_render_settings_page'
    );
});

add_action('admin_init', function () {
    register_setting('synapcores_widget', 'synapcores_widget_api_base');
    register_setting('synapcores_widget', 'synapcores_widget_project_key');
});

function synapcores_widget_render_settings_page() {
    ?>
    <div class="wrap">
        <h1>SynapCores Widget</h1>
        <form method="post" action="options.php">
            <?php settings_fields('synapcores_widget'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th><label for="synapcores_widget_api_base">Proxy URL</label></th>
                    <td>
                        <input
                          name="synapcores_widget_api_base"
                          id="synapcores_widget_api_base"
                          type="url"
                          class="regular-text"
                          placeholder="https://chat.your.com"
                          value="<?php echo esc_attr(get_option('synapcores_widget_api_base')); ?>"
                        />
                        <p class="description">Where the SynapCores widget-proxy is hosted.</p>
                    </td>
                </tr>
                <tr>
                    <th><label for="synapcores_widget_project_key">Project key</label></th>
                    <td>
                        <input
                          name="synapcores_widget_project_key"
                          id="synapcores_widget_project_key"
                          type="text"
                          class="regular-text"
                          placeholder="pk_abc123"
                          value="<?php echo esc_attr(get_option('synapcores_widget_project_key')); ?>"
                        />
                        <p class="description">Public project id — defined in the proxy's <code>projects.json</code>.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

// ----- Footer injection --------------------------------------------------

add_action('wp_footer', function () {
    $api_base    = trim((string) get_option('synapcores_widget_api_base'));
    $project_key = trim((string) get_option('synapcores_widget_project_key'));
    if (!$api_base || !$project_key) {
        return;
    }
    printf(
        '<script defer src="%s/widget.js" data-api-base="%s" data-project-key="%s"></script>',
        esc_url($api_base),
        esc_url($api_base),
        esc_attr($project_key)
    );
});
