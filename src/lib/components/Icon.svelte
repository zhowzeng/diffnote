<script module>
  // Only the icons Redline draws. Importing lucide's whole `icons` table and looking a name
  // up at runtime bundled every icon it has (6.4 MB), since the bundler can't tell which
  // names a string will be. A new icon goes here first; `IconName` makes svelte-check
  // reject any name that isn't.
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Binary from 'lucide-svelte/icons/binary';
  import Check from 'lucide-svelte/icons/check';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronsDownUp from 'lucide-svelte/icons/chevrons-down-up';
  import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
  import CircleAlert from 'lucide-svelte/icons/circle-alert';
  import CircleCheck from 'lucide-svelte/icons/circle-check';
  import Cog from 'lucide-svelte/icons/cog';
  import Copy from 'lucide-svelte/icons/copy';
  import CornerUpRight from 'lucide-svelte/icons/corner-up-right';
  import File from 'lucide-svelte/icons/file';
  import FileCheck from 'lucide-svelte/icons/file-check';
  import FileCode from 'lucide-svelte/icons/file-code';
  import FileText from 'lucide-svelte/icons/file-text';
  import Folder from 'lucide-svelte/icons/folder';
  import FolderGit2 from 'lucide-svelte/icons/folder-git-2';
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import FolderPlus from 'lucide-svelte/icons/folder-plus';
  import GitBranch from 'lucide-svelte/icons/git-branch';
  import GitCommitHorizontal from 'lucide-svelte/icons/git-commit-horizontal';
  import GitCompare from 'lucide-svelte/icons/git-compare';
  import GitMerge from 'lucide-svelte/icons/git-merge';
  import GitPullRequest from 'lucide-svelte/icons/git-pull-request';
  import Info from 'lucide-svelte/icons/info';
  import Loader from 'lucide-svelte/icons/loader';
  import MessageSquare from 'lucide-svelte/icons/message-square';
  import MoreVertical from 'lucide-svelte/icons/more-vertical';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import RotateCw from 'lucide-svelte/icons/rotate-cw';
  import Search from 'lucide-svelte/icons/search';
  import SearchX from 'lucide-svelte/icons/search-x';
  import Settings from 'lucide-svelte/icons/settings';
  import Settings2 from 'lucide-svelte/icons/settings-2';
  import Terminal from 'lucide-svelte/icons/terminal';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import X from 'lucide-svelte/icons/x';

  const ICONS = {
    'arrow-right': ArrowRight,
    binary: Binary,
    check: Check,
    'chevron-down': ChevronDown,
    'chevron-right': ChevronRight,
    'chevrons-down-up': ChevronsDownUp,
    'chevrons-up-down': ChevronsUpDown,
    'circle-alert': CircleAlert,
    'circle-check': CircleCheck,
    cog: Cog,
    copy: Copy,
    'corner-up-right': CornerUpRight,
    file: File,
    'file-check': FileCheck,
    'file-code': FileCode,
    'file-text': FileText,
    folder: Folder,
    'folder-git-2': FolderGit2,
    'folder-open': FolderOpen,
    'folder-plus': FolderPlus,
    'git-branch': GitBranch,
    'git-commit-horizontal': GitCommitHorizontal,
    'git-compare': GitCompare,
    'git-merge': GitMerge,
    'git-pull-request': GitPullRequest,
    info: Info,
    loader: Loader,
    'message-square': MessageSquare,
    'more-vertical': MoreVertical,
    'refresh-cw': RefreshCw,
    'rotate-cw': RotateCw,
    search: Search,
    'search-x': SearchX,
    settings: Settings,
    'settings-2': Settings2,
    terminal: Terminal,
    'trash-2': Trash2,
    'triangle-alert': TriangleAlert,
    x: X,
  };

  /** @typedef {keyof typeof ICONS} IconName */
</script>

<script>
  /**
   * @typedef {Object} Props
   * @property {IconName} name
   * @property {number} [size]
   * @property {string} [color]
   * @property {number} [strokeWidth]
   * @property {string} [class]
   */

  /** @type {Props} */
  let { name, size = 16, color = 'currentColor', strokeWidth = 1.75, class: className = '' } = $props();

  let Comp = $derived(ICONS[name]);
</script>

<Comp {size} {color} {strokeWidth} class={className} aria-hidden="true" />
