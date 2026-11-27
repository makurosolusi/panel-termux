import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_auth.sql';
import m0002 from './0002_dev.sql';
import m0003 from './0003_sites.sql';
import m0004 from './0004_deploy.sql';
import m0005 from './0005_drop_invites.sql';
import m0006 from './0006_data_safety.sql';
import m0007 from './0007_sites_lifecycle.sql';
import m0008 from './0008_monitor.sql';
import m0009 from './0009_user_locale.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007,
m0008,
m0009
    }
  }
  