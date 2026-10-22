import {EditorState} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {closeBrackets,closeBracketsKeymap} from '@codemirror/autocomplete';

// Quotes and dollar signs have other meanings in LaTeX, so only pair brackets.
export const bracketCompletion=[
  EditorState.languageData.of(()=>[{closeBrackets:{brackets:['(','[','{']}}]),
  closeBrackets(),keymap.of(closeBracketsKeymap),
];
